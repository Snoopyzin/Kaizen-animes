import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import './index.css'
import '@radix-ui/themes/styles.css'

/* ------------------------ fonts ----------------------- */
// inter
import '@fontsource/inter/100.css'
import '@fontsource/inter/200.css'
import '@fontsource/inter/300.css'
import '@fontsource/inter/400.css'
import '@fontsource/inter/500.css'
import '@fontsource/inter/600.css'
import '@fontsource/inter/700.css'
import '@fontsource/inter/800.css'
import '@fontsource/inter/900.css'
// space mono
import '@fontsource/space-mono/400.css'
import '@fontsource/space-mono/700.css'
import KaizenProvider from './utils/ContextProvider.jsx'
import { AuthProvider } from './auth/AuthContext.jsx'
import AuthGate from './auth/AuthGate.jsx'
/* ------------------------------------------------------ */
// language choice -> login -> active subscription, then the app itself
ReactDOM.createRoot(document.getElementById('root')).render(
  <AuthProvider>
    <AuthGate>
      <KaizenProvider>
        <App />
      </KaizenProvider>
    </AuthGate>
  </AuthProvider>
)
