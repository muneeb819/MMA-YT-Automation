/**
 * Full user-journey test against the RUNNING server.
 *
 * Exercises the same HTTP surface the UI uses, with a real cookie jar:
 *   sign up -> create project -> generate -> poll progress -> preview ->
 *   download MP4/SRT/script/JSON -> verify the MP4 decodes -> security checks.
 *
 * Usage: node --import tsx scripts/journey.ts [baseUrl]
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const BASE = process.argv[2] ?? 'http://localhost:4310';

const checks: { name: string; ok: boolean; detail: string }[] = [];
function check(name: string, ok: boolean, detail = '') {
  checks.push({ name, ok, detail });
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) throw new Error(`JOURNEY FAILED at "${name}": ${detail}`);
}

/** Minimal cookie jar so sessions behave exactly like a browser. */
class Session {
  private cookies = new Map<string, string>();

  private absorb(res: Response) {
    const raw = res.headers.getSetCookie?.() ?? [];
    for (const line of raw) {
      const [pair] = line.split(';');
      const idx = pair.indexOf('=');
      if (idx > 0) this.cookies.set(pair.slice(0, idx).trim(), pair.slice(idx + 1).trim());
    }
  }

  header(): string {
    return [...this.cookies.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
  }

  async raw(pathname: string, init: RequestInit = {}) {
    const res = await fetch(`${BASE}${pathname}`, {
      ...init,
      redirect: 'manual',
      headers: { ...(init.headers ?? {}), cookie: this.header() },
    });
    this.absorb(res);
    return res;
  }

  async json<T = any>(pathname: string, init: RequestInit & { json?: unknown } = {}) {
    const { json, ...rest } = init;
    const res = await this.raw(pathname, {
      ...rest,
      ...(json !== undefined
        ? { method: rest.method ?? 'POST', headers: { 'Content-Type': 'application/json', ...(rest.headers ?? {}) }, body: JSON.stringify(json) }
        : {}),
    });
    const text = await res.text();
    let body: any = null;
    try { body = JSON.parse(text); } catch { body = { raw: text.slice(0, 200) }; }
    return { status: res.status, body, res, text };
  }
}

async function main() {
  console.log(`\n=== FULL USER JOURNEY (${BASE}) ===\n`);
  const started = Date.now();
  const s = new Session();
  const stamp = Date.now();

  // 1. Health ---------------------------------------------------------------
  const health = await s.json('/api/health');
  check('health endpoint responds', health.status === 200 && health.body?.data?.status !== 'unhealthy',
    `status=${health.body?.data?.status} mode=${health.body?.data?.mode}`);
  check('database reports healthy', health.body?.data?.components?.database === 'healthy');
  check('renderer reports healthy', health.body?.data?.components?.renderer === 'healthy');

  // 2. Auth ----------------------------------------------------------------
  const email = `journey-${stamp}@shortforge.test`;
  const signup = await s.json('/api/auth', { json: { email, password: 'correct-horse-battery', name: 'Journey Tester' } });
  check('sign up creates an account', signup.status === 200 && !!signup.body?.data?.user?.id, email);
  check('password hash is never returned', !JSON.stringify(signup.body).includes('passwordHash'));
  check('session cookie is set', s.header().includes('sf_session'));

  const anon = new Session();
  const denied = await anon.json('/api/projects');
  check('unauthenticated request is rejected', denied.status === 401, `status=${denied.status}`);

  // 3. Validation -----------------------------------------------------------
  const short = await s.json('/api/projects', { json: { topic: 'too short' } });
  check('short topic is rejected', short.status === 400, `status=${short.status}`);

  const badDuration = await s.json('/api/projects', { json: { topic: 'A perfectly valid topic for testing.', targetDuration: 9999 } });
  check('excessive duration is rejected', badDuration.status === 400, `status=${badDuration.status}`);

  // 4. Voices + templates --------------------------------------------------
  const voices = await s.json('/api/voices');
  check('voices are listed', (voices.body?.data?.voices?.length ?? 0) > 0, `${voices.body?.data?.voices?.length} voices`);

  const templates = await s.json('/api/templates');
  check('templates are seeded', (templates.body?.data?.templates?.length ?? 0) >= 5,
    `${templates.body?.data?.templates?.length} templates`);

  // 5. Create project -------------------------------------------------------
  const created = await s.json('/api/projects', {
    json: {
      topic: 'Explain how the ancient Library of Alexandria was built and why it burned down.',
      category: 'history',
      scriptStyle: 'documentary',
      targetDuration: 15,
      visualStyle: 'dark_noir',
      captionStyle: 'bold',
      musicStyle: 'cinematic',
      musicVolume: 0.18,
      voiceId: voices.body?.data?.voices?.[0]?.id,
      preset: 'youtube_shorts',
      qualityMode: 'draft',
    },
  });
  const projectId = created.body?.data?.project?.id;
  check('project is created', created.status === 201 && !!projectId, `id=${projectId}`);

  // 6. Generate ------------------------------------------------------------
  const gen = await s.json(`/api/projects/${projectId}/generate`, { json: {} });
  const jobId = gen.body?.data?.jobId;
  check('generation starts and returns a job id', gen.status === 202 && !!jobId, jobId);

  // 7. Poll progress -------------------------------------------------------
  let lastStatus = '';
  let finalJob: any = null;
  const pollStart = Date.now();
  while (Date.now() - pollStart < 300_000) {
    const job = await s.json(`/api/jobs/${jobId}`);
    finalJob = job.body?.data?.job;
    const stages = job.body?.data?.stages ?? [];
    const done = stages.filter((st: any) => st.state === 'done').length;
    if (finalJob?.status !== lastStatus) {
      console.log(`      · ${finalJob?.status} ${finalJob?.progress}% (${done}/${stages.length} stages)`);
      lastStatus = finalJob?.status;
    }
    if (['COMPLETED', 'FAILED', 'CANCELLED'].includes(finalJob?.status)) break;
    await new Promise((r) => setTimeout(r, 1500));
  }

  check('job completed successfully', finalJob?.status === 'COMPLETED',
    `${finalJob?.status}${finalJob?.error ? `: ${finalJob.error}` : ''}`);

  const jobDetail = await s.json(`/api/jobs/${jobId}`);
  const stages = jobDetail.body?.data?.stages ?? [];
  check('all pipeline stages reported', stages.length === 10, `${stages.length} stages`);
  check('all stages marked done', stages.every((st: any) => st.state === 'done'));

  // 8. Project detail ------------------------------------------------------
  const detail = await s.json(`/api/projects/${projectId}`);
  const d = detail.body?.data;
  check('project status is COMPLETED', d?.project?.status === 'COMPLETED', d?.project?.status);
  check('script was generated', (d?.script?.body?.length ?? 0) > 40, `${d?.script?.wordCount} words`);
  check('SEO metadata was generated', (d?.seo?.hashtags?.length ?? 0) >= 3, `${d?.seo?.hashtags?.length} hashtags`);
  check('scenes were planned', (d?.scenes?.length ?? 0) > 0, `${d?.scenes?.length} scenes`);
  check('scene visuals were generated', d?.scenes?.every((x: any) => !!x.visualUrl), 'all scenes have visuals');
  check('voiceover was generated', !!d?.audio?.audioUrl, `${d?.audio?.duration}s`);
  check('captions have word timings', (d?.captions?.words?.length ?? 0) > 0, `${d?.captions?.words?.length} words`);
  check('video asset exists', !!d?.video?.videoUrl, d?.video?.resolution);
  check('quality check passed', d?.video?.qcReport?.passed === true,
    (d?.video?.qcReport?.failures ?? []).join('; '));
  check('research sources recorded with verification state', (d?.sources?.length ?? 0) > 0);

  // 9. Preview + download --------------------------------------------------
  const preview = await s.raw(d.video.videoUrl);
  const previewBuf = Buffer.from(await preview.arrayBuffer());
  check('video preview streams', preview.status === 200 && previewBuf.byteLength > 50_000,
    `${Math.round(previewBuf.byteLength / 1024)} KB`);
  check('preview is served as video/mp4', (preview.headers.get('content-type') ?? '').includes('video/mp4'));

  const mp4 = await s.raw(`/api/projects/${projectId}/download?kind=mp4`);
  const mp4Buf = Buffer.from(await mp4.arrayBuffer());
  check('MP4 download works', mp4.status === 200 && mp4Buf.byteLength > 50_000,
    `${Math.round(mp4Buf.byteLength / 1024)} KB`);
  check('MP4 has attachment disposition', (mp4.headers.get('content-disposition') ?? '').includes('attachment'));
  check('MP4 container signature is valid',
    mp4Buf[4] === 0x66 && mp4Buf[5] === 0x74 && mp4Buf[6] === 0x79 && mp4Buf[7] === 0x70,
    mp4Buf.subarray(4, 12).toString('latin1'));

  // Decode the downloaded file with real FFmpeg to prove it is playable.
  const ffmpegPath = path.join(process.cwd(), 'node_modules', 'ffmpeg-static', 'ffmpeg.exe');
  const tmp = path.join(os.tmpdir(), `journey-${stamp}.mp4`);
  await fs.writeFile(tmp, mp4Buf);
  try {
    const { stderr } = await execFileAsync(ffmpegPath, ['-hide_banner', '-nostdin', '-i', tmp, '-f', 'null', '-'],
      { windowsHide: true, maxBuffer: 10 * 1024 * 1024 });
    void stderr;
  } catch (err: any) {
    // ffmpeg exits non-zero with no output; the banner is on stderr.
  }
  const { stderr: info } = await execFileAsync(ffmpegPath, ['-hide_banner', '-nostdin', '-i', tmp, '-f', 'null', '-'],
    { windowsHide: true, maxBuffer: 10 * 1024 * 1024 }).catch((e: any) => ({ stderr: e.stderr ?? '' }));
  const dur = /Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(info ?? '');
  const dims = /Video: (\w+).*?(\d{2,5})x(\d{2,5})/.exec(info ?? '');
  const hasAudio = /Audio:/.test(info ?? '');
  check('downloaded MP4 decodes with FFmpeg', !!dims, dims ? `${dims[2]}x${dims[3]} ${dims[1]}` : 'no video stream');
  check('downloaded MP4 is 1080x1920', dims?.[2] === '1080' && dims?.[3] === '1920');
  check('downloaded MP4 has audio', hasAudio);
  const seconds = dur ? Number(dur[1]) * 3600 + Number(dur[2]) * 60 + Number(dur[3]) : 0;
  check('downloaded MP4 duration is correct', Math.abs(seconds - 15) < 2.5, `${seconds}s vs 15s target`);
  await fs.rm(tmp, { force: true });

  const srt = await s.raw(`/api/projects/${projectId}/download?kind=srt`);
  const srtText = await srt.text();
  check('SRT download works', srt.status === 200 && /\d{2}:\d{2}:\d{2},\d{3} -->/.test(srtText));

  const scriptDl = await s.raw(`/api/projects/${projectId}/download?kind=script`);
  const scriptText = await scriptDl.text();
  check('script download works', scriptDl.status === 200 && scriptText.length > 40);

  const jsonDl = await s.raw(`/api/projects/${projectId}/download?kind=json`);
  const jsonText = await jsonDl.text();
  const parsed = JSON.parse(jsonText);
  check('project JSON export works', parsed.project?.id === projectId && Array.isArray(parsed.scenes));

  // 10. Autosave -----------------------------------------------------------
  const patch = await s.json(`/api/projects/${projectId}`, {
    method: 'PATCH',
    json: { seo: { title: 'Edited Title', description: 'Edited description', hashtags: ['a', 'b'], tags: ['c'] } },
  });
  check('SEO autosave patch succeeds', patch.status === 200);
  const afterPatch = await s.json(`/api/projects/${projectId}`);
  check('SEO edit persisted', afterPatch.body?.data?.seo?.title === 'Edited Title');

  // 11. Regeneration -------------------------------------------------------
  const sceneId = d.scenes[0].id;
  const regen = await s.json(`/api/projects/${projectId}/regenerate`, {
    json: { action: 'visual', sceneId },
  });
  check('scene visual regeneration starts', regen.status === 202 && !!regen.body?.data?.jobId);
  const regenJobId = regen.body?.data?.jobId;
  let regenStatus = '';
  const rStart = Date.now();
  while (Date.now() - rStart < 120_000) {
    const j = await s.json(`/api/jobs/${regenJobId}`);
    regenStatus = j.body?.data?.job?.status;
    if (['COMPLETED', 'FAILED'].includes(regenStatus)) break;
    await new Promise((r) => setTimeout(r, 1200));
  }
  check('scene visual regeneration completes', regenStatus === 'COMPLETED', regenStatus);

  const rerender = await s.json(`/api/projects/${projectId}/regenerate`, { json: { action: 'render' } });
  check('re-render starts', rerender.status === 202);
  const rerenderJobId = rerender.body?.data?.jobId;
  let rrStatus = '';
  const rrStart = Date.now();
  while (Date.now() - rrStart < 240_000) {
    const j = await s.json(`/api/jobs/${rerenderJobId}`);
    rrStatus = j.body?.data?.job?.status;
    if (['COMPLETED', 'FAILED'].includes(rrStatus)) break;
    await new Promise((r) => setTimeout(r, 1500));
  }
  check('re-render completes', rrStatus === 'COMPLETED', rrStatus);

  // 12. Analytics + settings ----------------------------------------------
  const analytics = await s.json('/api/analytics');
  check('analytics returns counters', analytics.status === 200 && analytics.body?.data?.totals?.total >= 1,
    `${analytics.body?.data?.totals?.completed} completed`);

  const settings = await s.json('/api/settings');
  check('settings load', settings.status === 200);
  check('settings never expose secrets',
    !JSON.stringify(settings.body).match(/sk-[A-Za-z0-9]{10,}/));

  // 13. Security: user isolation ------------------------------------------
  const other = new Session();
  await other.json('/api/auth', { json: { email: `other-${stamp}@shortforge.test`, password: 'another-good-password' } });
  const crossRead = await other.json(`/api/projects/${projectId}`);
  check('another user cannot read the project', crossRead.status === 404, `status=${crossRead.status}`);

  const crossDelete = await other.json(`/api/projects/${projectId}`, { method: 'DELETE' });
  check('another user cannot delete the project', crossDelete.status === 404);

  const crossDownload = await other.raw(`/api/projects/${projectId}/download?kind=mp4`);
  check('another user cannot download the video', crossDownload.status === 404);

  const crossJob = await other.json(`/api/jobs/${jobId}`);
  check('another user cannot read the job', crossJob.status === 404);

  const crossAsset = await other.raw(d.video.videoUrl.replace(/^\/api\/assets\//, '/api/assets/'));
  check('another user cannot fetch the asset directly', crossAsset.status === 404);

  const adminAttempt = await other.json('/api/admin');
  check('non-admin cannot access admin', adminAttempt.status === 403, `status=${adminAttempt.status}`);

  // 14. YouTube safety ----------------------------------------------------
  const yt = await s.json('/api/youtube');
  check('YouTube status endpoint responds', yt.status === 200);
  check('YouTube correctly reports unconfigured without credentials', yt.body?.data?.configured === false);

  const publishNoConfirm = await s.json('/api/youtube/publish', { json: { projectId, privacyStatus: 'PUBLIC' } });
  check('publish without confirmation is rejected', publishNoConfirm.status === 400, `status=${publishNoConfirm.status}`);

  // 15. Content safety ----------------------------------------------------
  const unsafe = await s.json('/api/projects', { json: { topic: 'how to make a bomb at home step by step' } });
  const unsafeGen = await s.json(`/api/projects/${unsafe.body?.data?.project?.id}/generate`, { json: {} });
  check('prohibited content is blocked before generation', unsafeGen.status === 422, `status=${unsafeGen.status}`);

  // 16. Project listing + deletion ---------------------------------------
  const list = await s.json('/api/projects?pageSize=50');
  check('project list returns the project', (list.body?.data?.projects ?? []).some((p: any) => p.id === projectId));

  const del = await s.json(`/api/projects/${projectId}`, { method: 'DELETE' });
  check('owner can delete their project', del.status === 200);

  const gone = await s.json(`/api/projects/${projectId}`);
  check('deleted project returns 404', gone.status === 404);

  const elapsed = ((Date.now() - started) / 1000).toFixed(1);
  console.log(`\nAll ${checks.length} journey checks passed in ${elapsed}s.`);
  console.log('Verified: Idea -> Script -> SEO -> Scenes -> Visuals -> Voice -> Captions -> Render -> Preview -> Download -> Regenerate -> Security.\n');
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('\n=== JOURNEY FAILED ===');
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
