import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import { initAnalytics } from './analytics'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

// Defer analytics init until the browser is idle so it never competes
// with the initial render/hydration for main-thread time.
if ('requestIdleCallback' in window) {
  requestIdleCallback(initAnalytics)
} else {
  setTimeout(initAnalytics, 1)
}
