import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App'
import { initializeKnowledgeDrafts } from './lib/knowledgeDrafts'
import { initializeAppearance, syncBrowserAppearance } from './lib/appearance'

window.addEventListener('storage', syncBrowserAppearance)
void Promise.all([initializeAppearance(), initializeKnowledgeDrafts()]).finally(() => {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
})
