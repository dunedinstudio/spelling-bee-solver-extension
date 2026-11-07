const icons = Object.fromEntries([16, 32, 48, 128].map(size => [size, `icons/icon-${size}.png`]));

export function manifest(browser, version = '0.1.2') {
  const base = {
    manifest_version: 3,
    name: 'Spelling Bee Solver',
    version,
    permissions: ['storage'],
    description: 'Enter seven letters in a honeycomb to instantly find matching dictionary words and pangrams. Works offline.',
    icons,
    action: { default_title: 'Spelling Bee Solver', default_popup: 'popup.html', default_icon: icons },
    content_security_policy: {
      extension_pages: "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
    },
  };
  if (browser === 'firefox') {
    return { ...base, browser_specific_settings: { gecko: {
      id: '{5233b61b-0800-46ea-a20c-6d9b8e410acf}',
      strict_min_version: '140.0',
      data_collection_permissions: { required: ['none'] },
    } } };
  }
  return base;
}
