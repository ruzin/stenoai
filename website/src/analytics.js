let posthogPromise = null

function loadPosthog() {
  if (!posthogPromise) {
    posthogPromise = import('posthog-js').then((m) => m.default)
  }
  return posthogPromise
}

export function initAnalytics() {
  if (!import.meta.env.PROD) return
  loadPosthog().then((posthog) => {
    posthog.init('phc_U2cnTyIyKGNSVaK18FyBMltd8nmN7uHxhhm21fAHwqb', {
      api_host: 'https://us.i.posthog.com',
      person_profiles: 'identified_only',
      capture_pageview: true,
    })
  })
}

export function trackDownload(location, arch) {
  loadPosthog().then((posthog) => posthog.capture('download_clicked', { location, arch }))
}

export function trackGitHub(location) {
  loadPosthog().then((posthog) => posthog.capture('github_clicked', { location }))
}
