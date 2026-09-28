/**
 * Live provider verification.
 *
 * Exercises the REAL OpenAI provider (script + SEO + research) and the REAL
 * ElevenLabs provider, so the adapters are validated against the live APIs
 * rather than assumed to work.
 *
 * Run: node --env-file=.env.local --import tsx scripts/verify-live.ts
 */
import { getLLM, getVoice } from '../src/providers/registry';
import { config, MOCK_MODE } from '../src/lib/config';

const line = (s: string) => console.log(`\n${'='.repeat(70)}\n${s}\n${'='.repeat(70)}`);

async function main() {
  line('PROVIDER WIRING');
  console.log(`MOCK_MODE          : ${MOCK_MODE}`);
  console.log(`OpenAI configured  : ${config.llm.configured} (${config.llm.model})`);
  console.log(`ElevenLabs config. : ${config.voice.configured}`);
  console.log(`Replicate config.  : ${config.replicate.configured}`);

  const llm = getLLM();
  const voice = getVoice();

  // ---------------------------------------------------------------- health
  line('HEALTH');
  console.log('openai    :', JSON.stringify(await llm.health()));
  console.log('elevenlabs:', JSON.stringify(await voice.health()));

  // ------------------------------------------------------- real AI script
  line('LIVE SCRIPT GENERATION (real OpenAI call)');
  const started = Date.now();
  const script = await llm.generateScript({
    topic: 'How the Antikythera mechanism allowed ancient Greeks to predict eclipses',
    category: 'history',
    style: 'documentary',
    targetDuration: 30,
    language: 'en',
    templateBeats: ['Hook', 'Context', 'Escalation', 'Key revelation', 'Conclusion'],
    revisionInstruction: null,
  });
  console.log(`generated in ${((Date.now() - started) / 1000).toFixed(1)}s`);
  console.log('\nHOOK    :', script.hook);
  console.log('SCRIPT  :', script.script);
  console.log('CTA     :', script.cta);
  console.log('\nTITLE   :', script.title);
  console.log('DURATION:', script.estimatedDuration, 's');
  console.log('SCENES  :', script.scenes.length);
  script.scenes.forEach((s) =>
    console.log(`  ${s.sceneNumber}. [${s.visualType}/${s.transition}] ${s.text.slice(0, 70)}...`),
  );

  // --------------------------------------------------------- real AI SEO
  line('LIVE SEO GENERATION (real OpenAI call)');
  const seo = await llm.generateSeo({
    topic: 'How the Antikythera mechanism allowed ancient Greeks to predict eclipses',
    category: 'history',
    script: script.script,
    hook: script.hook,
    language: 'en',
  });
  console.log('TITLE       :', seo.title);
  console.log('VARIANTS    :', seo.titleVariants.length);
  seo.titleVariants.forEach((t) => console.log('   -', t));
  console.log('DESCRIPTION :', seo.description.slice(0, 220) + '…');
  console.log('HASHTAGS    :', seo.hashtags.length, '->', seo.hashtags.slice(0, 8).join(' '));
  console.log('TAGS        :', seo.tags.length);
  console.log('KEYWORDS    :', seo.keywords.primary.join(', '), '|', seo.keywords.secondary.slice(0, 5).join(', '));
  console.log('HOOK SCORE  :', JSON.stringify(seo.hookScore));

  // ------------------------------------------------------- real research
  line('LIVE RESEARCH (real OpenAI call — no search provider)');
  const research = await llm.research({
    topic: 'Antikythera mechanism',
    category: 'history',
    requireFresh: false,
  });
  console.log('unverified flag :', research.unverified, '(expected: true — no search backend)');
  console.log('facts           :', research.facts.length);
  research.facts.forEach((f) =>
    console.log(`   verified=${f.verified} ${f.fact.slice(0, 90)}`),
  );

  // ---------------------------------------------------- real ElevenLabs
  line('LIVE VOICE (real ElevenLabs call)');
  const voices = await voice.listVoices();
  console.log('voices returned :', Array.isArray(voices) ? voices.length : 0);
  if (Array.isArray(voices) && voices.length) {
    console.log('sample          :', JSON.stringify(voices.slice(0, 3), null, 1));
    const target = voices[0];
    try {
      const t0 = Date.now();
      const result = await voice.synthesize(
        'Nobody expected what happened next.',
        { voiceId: target.id, voiceName: target.name, speed: 1, stability: 0.5 },
      );
      console.log(`\nsynthesised in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
      console.log('  audio bytes :', result.audio.byteLength);
      console.log('  duration    :', result.durationSeconds, 's');
      console.log('  generationId:', result.generationId);
    } catch (err) {
      console.log('\nSYNTHESIS FAILED:', err instanceof Error ? err.message : String(err));
    }
  }

  line('DONE');
  process.exit(0);
}

main().catch((err) => {
  console.error('\nLIVE VERIFICATION FAILED');
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
