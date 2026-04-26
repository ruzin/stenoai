import posthog from 'posthog-js'

export function trackDownload(location, arch) {
  posthog.capture('download_clicked', { location, arch })
}

export function trackGitHub(location) {
  posthog.capture('github_clicked', { location })
}
