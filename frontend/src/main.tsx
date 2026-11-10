import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App'
import { initializeAppearance, syncBrowserAppearance } from './lib/appearance'

window.addEventListener('storage', syncBrowserAppearance)
void initializeAppearance().finally(() => {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
})
