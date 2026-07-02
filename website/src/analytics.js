let posthogPromise = null

function loadPosthog() {
  if (!posthogPromise) {
    posthogPromise = import('posthog-js')
      .then((m) => {
        const posthog = m.default
        if (import.meta.env.PROD) {
          posthog.init('phc_U2cnTyIyKGNSVaK18FyBMltd8nmN7uHxhhm21fAHwqb', {
            api_host: 'https://us.i.posthog.com',
            person_profiles: 'identified_only',
            capture_pageview: true,
          })
        }
        return posthog
      })
      .catch((err) => {
        posthogPromise = null
        throw err
      })
  }
  return posthogPromise
}

export function initAnalytics() {
  if (!import.meta.env.PROD) return
  loadPosthog()
}

export function trackDownload(location, arch) {
  loadPosthog().then((posthog) => posthog.capture('download_clicked', { location, arch }))
}

export function trackGitHub(location) {
  loadPosthog().then((posthog) => posthog.capture('github_clicked', { location }))
}
