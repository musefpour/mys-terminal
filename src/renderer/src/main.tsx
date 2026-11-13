import { createRoot } from 'react-dom/client'
import '@fontsource/vazirmatn/400.css'
import '@fontsource/vazirmatn/600.css'
import '@xterm/xterm/css/xterm.css'
import { App, DetachedApp } from './App'
import { LockGate } from './components/Lock'
import { ModelProvider } from './model'
import './styles.css'

document.documentElement.dataset.platform = window.mys.platform

const root = document.getElementById('root')
// A tab moved out of the main window opens the same page with #detached.
const detached = window.location.hash === '#detached'
if (detached) document.documentElement.dataset.detached = 'true'
if (root) {
  createRoot(root).render(
    <LockGate>
      <ModelProvider detached={detached}>
        {detached ? <DetachedApp /> : <App />}
      </ModelProvider>
    </LockGate>,
  )
}
