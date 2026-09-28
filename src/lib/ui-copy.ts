/** Shared marketing/UI copy so the demo-mode disclosure is consistent everywhere. */

export const MOCK_MODE_TEXT =
  'Running in demo mode: scripts, voices and visuals are synthetic, but the video pipeline and FFmpeg rendering are real.';

export const OPTIMISATION_GOALS = [
  {
    title: 'Strong first-second hook',
    body: 'The opening line withholds the payoff so the reason to keep watching is immediate.',
  },
  {
    title: 'High information density',
    body: 'One idea per sentence, paced to 2.0–2.8 spoken words per second.',
  },
  {
    title: 'Curiosity loops',
    body: 'Each beat raises a question the next beat answers.',
  },
  {
    title: 'Pattern interruption',
    body: 'Visual changes and sentence-length variation prevent autopilot viewing.',
  },
  {
    title: 'Mobile-first captions',
    body: 'Word-level timing, high contrast and safe margins for phone screens.',
  },
  {
    title: 'SEO metadata',
    body: 'Titles, descriptions, hashtags and tags drafted alongside the script.',
  },
];

export const PIPELINE_STEPS = [
  { step: 'Idea', body: 'You describe the video in one sentence.' },
  { step: 'Research', body: 'Optional grounding in real sources, with unverified claims flagged.' },
  { step: 'Script', body: 'Hook, context, escalation, revelation, conclusion.' },
  { step: 'SEO', body: 'Titles, description, hashtags, tags and keywords.' },
  { step: 'Scenes', body: 'Narration split into timed, filmable beats.' },
  { step: 'Visuals', body: 'Generated or licensed media per scene.' },
  { step: 'Voice', body: 'Narration synthesised to match the target duration.' },
  { step: 'Captions', body: 'Word-level timing rendered for mobile.' },
  { step: 'Render', body: 'FFmpeg composes 1080×1920 H.264 with audio and captions.' },
  { step: 'Quality check', body: 'Duration, resolution, audio and decodability are verified.' },
];

export const FEATURES = [
  {
    title: 'One-click pipeline',
    body: 'Idea to finished MP4 in a single job. Research, script, voice, visuals, captions and render run in order with live progress.',
  },
  {
    title: 'True word-level captions',
    body: 'Captions are aligned to narration timing and burned in with safe margins so they stay readable on a phone.',
  },
  {
    title: 'Regenerate anything, individually',
    body: 'Fix one scene, one visual or one voice line without paying to regenerate the whole project.',
  },
  {
    title: 'Honest research provenance',
    body: 'Sources are stored with the project. Anything that cannot be verified is marked UNVERIFIED instead of being invented.',
  },
  {
    title: 'Rights-aware media',
    body: 'Every asset records where it came from. We generate backgrounds and music locally so licensing is never in doubt.',
  },
  {
    title: 'Publish with confirmation',
    body: 'YouTube publishing is private by default and always requires an explicit confirmation of channel, title and visibility.',
  },
  {
    title: 'Runs without any API keys',
    body: 'Demo mode produces real rendered video using local providers, so you can evaluate the whole workflow before connecting anything.',
  },
  {
    title: 'Provider-agnostic core',
    body: 'LLM, voice, image, storage and rendering all sit behind interfaces, so vendors can be swapped without touching the pipeline.',
  },
];

export const USE_CASES = [
  { title: 'Faceless channels', body: 'Consistent narration-driven shorts on a schedule.' },
  { title: 'Education creators', body: 'Break complex topics into one clear idea per short.' },
  { title: 'Documentary storytelling', body: 'Researched, structured narratives with sourced facts.' },
  { title: 'Social agencies', body: 'Produce client shorts faster, with brand kits per workspace.' },
  { title: 'Newsletter to video', body: 'Turn a written idea into a vertical video quickly.' },
  { title: 'Language learning', body: 'Scripted, paced narration for vocabulary practice.' },
];

/** Pricing is configuration-driven; the UI reads these tiers. */
export const PRICING_TIERS = [
  {
    id: 'free',
    name: 'Free',
    price: 0,
    priceLabel: '$0',
    period: 'forever',
    description: 'Try the full workflow with demo mode.',
    features: [
      '5 generations per month',
      'Demo providers (no API keys needed)',
      'Up to 45s videos',
      '1080×1920 MP4 export',
      'Watermark-free downloads',
    ],
    cta: 'Start free',
    highlight: false,
  },
  {
    id: 'creator',
    name: 'Creator',
    price: 19,
    priceLabel: '$19',
    period: 'per month',
    description: 'For creators publishing on a schedule.',
    features: [
      '100 generations per month',
      'Bring your own OpenAI + ElevenLabs keys',
      'Up to 90s videos',
      'Premium visual styles',
      'YouTube publishing',
      'Priority rendering',
    ],
    cta: 'Choose Creator',
    highlight: true,
  },
  {
    id: 'pro',
    name: 'Pro',
    price: 49,
    priceLabel: '$49',
    period: 'per month',
    description: 'Higher volume and premium assets.',
    features: [
      '400 generations per month',
      'AI video generation (Replicate)',
      'Custom templates',
      'Brand kit per workspace',
      'Version history and restores',
      'Faster queue',
    ],
    cta: 'Choose Pro',
    highlight: false,
  },
  {
    id: 'agency',
    name: 'Agency',
    price: 149,
    priceLabel: '$149',
    period: 'per month',
    description: 'Multiple users and client workspaces.',
    features: [
      '2,000 generations per month',
      'Unlimited team members',
      'Multiple workspaces',
      'Client approval flow',
      'Admin analytics',
      'Priority support',
    ],
    cta: 'Talk to us',
    highlight: false,
  },
];

export const FAQ = [
  {
    q: 'Does this guarantee my videos go viral?',
    a: 'No. No tool can guarantee reach. ShortForge optimises for measurable craft characteristics — a strong hook, high information density, fast pacing, clear structure, pattern interruption and mobile-readable captions. Those help a video hold attention; they do not promise a specific view count.',
  },
  {
    q: 'What happens without API keys?',
    a: 'The app runs in demo mode. Scripts, voices and visuals are clearly-labelled synthetic output, but the timeline, captions and FFmpeg rendering are real, so you get a genuine playable MP4. The UI always shows a "Demo / Mock Mode" badge so demo output is never mistaken for production output.',
  },
  {
    q: 'Who owns the content rights?',
    a: 'You do. Every asset records its source. We never scrape or reuse copyrighted video, and background music is synthesised locally so there is no licensing ambiguity.',
  },
  {
    q: 'Can I fix a single scene without regenerating everything?',
    a: 'Yes. You can regenerate the script, a single scene, one visual, the voiceover or captions individually. Each only re-runs the affected stage.',
  },
  {
    q: 'Will it publish to my channel automatically?',
    a: 'Never. Publishing requires YouTube OAuth and an explicit confirmation showing the exact channel, title, description and visibility. The default visibility is Private.',
  },
  {
    q: 'How accurate is the research?',
    a: 'Research is optional. When no search provider is connected we do not invent citations — facts are marked UNVERIFIED and shown in the project so you can check them before publishing.',
  },
  {
    q: 'What video format do I get?',
    a: '1080×1920 (9:16) MP4, H.264 video with AAC audio at 30fps, optimised for YouTube Shorts. Configurable per content preset.',
  },
  {
    q: 'Can I change the voice?',
    a: 'Yes. Voices come from ElevenLabs when configured, with adjustable speed, stability and style. Regenerating the voice does not regenerate the script or visuals.',
  },
];
