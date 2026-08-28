/**
 * Play-mode constants, separated from the play-mode module itself.
 *
 * The entry chunk and the E2E harness both need these names, and both must be
 * able to have them without importing the module that pulls in three.js. A
 * single static import of `playmode/index.ts` for one string constant would
 * collapse the code split and put the whole renderer in the entry chunk — where
 * the cold-load budget, measured on every device profile, would immediately
 * find it.
 */

/** Query parameter that starts play mode. */
export const PLAY_PARAM = 'play';

/** The scene the P1 frame budget is stated against. */
export const REFERENCE_2D = 'reference2d';

/** Overrides the entity count, so a harness can measure how cost scales. */
export const ENTITY_COUNT_PARAM = 'entities';

/** Where the harness reads raw frame samples from. Set only while playing. */
export const FRAME_SAMPLES_KEY = '__imagi3FrameSamples';

/** Attribute set on <html> once the first frame has been drawn. */
export const PLAYING_ATTRIBUTE = 'data-app-playing';
