export const NEXT_APP_COMPONENT_NAMES = Object.freeze([
    'page', 'layout', 'default', 'error', 'global-error', 'loading',
    'not-found', 'global-not-found', 'forbidden', 'unauthorized', 'template',
]);

export const NEXT_ROUTE_SEGMENT_NAMES = Object.freeze(['page', 'layout', 'route']);

export const NEXT_IMAGE_METADATA_NAMES = Object.freeze([
    'icon', 'apple-icon', 'opengraph-image', 'twitter-image',
]);

export const NEXT_METADATA_ROUTE_NAMES = Object.freeze([
    'manifest', 'robots', 'sitemap',
]);

const APP_CONVENTION_NAMES = [
    ...NEXT_APP_COMPONENT_NAMES,
    ...NEXT_ROUTE_SEGMENT_NAMES,
    ...NEXT_IMAGE_METADATA_NAMES,
    ...NEXT_METADATA_ROUTE_NAMES,
];
const appConventionGroup = [...new Set(APP_CONVENTION_NAMES)].join(',');

export const NEXT_ENTRY_GLOBS = Object.freeze([
    'pages/**/*.{js,jsx,ts,tsx}',
    'src/pages/**/*.{js,jsx,ts,tsx}',
    `app/**/{${appConventionGroup}}.{js,jsx,ts,tsx}`,
    `src/app/**/{${appConventionGroup}}.{js,jsx,ts,tsx}`,
    'instrumentation.{js,ts}',
    'src/instrumentation.{js,ts}',
    'instrumentation-client.{js,ts}',
    'src/instrumentation-client.{js,ts}',
    'proxy.{js,ts}',
    'src/proxy.{js,ts}',
    'middleware.{js,ts}',
    'src/middleware.{js,ts}',
    'mdx-components.{js,jsx,ts,tsx}',
    'src/mdx-components.{js,jsx,ts,tsx}',
]);

export const NEXT_PRESERVE_GLOBS = Object.freeze([
    ...NEXT_ENTRY_GLOBS,
    'public/**',
]);
