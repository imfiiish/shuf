import { lazy, Suspense } from 'react'
import {
  Navigate,
  Route,
  Routes,
  useLocation,
  useNavigate,
  useParams,
} from 'react-router-dom'
import CapsuleNav, { type CapsuleNavItem } from './CapsuleNav'
import { DEFAULT_BOOK } from './books/active'
import { useSettings } from './settings/context'
import Home from './home/Home'

// Home is the default route, so it stays eager. Every other route is split
// into its own chunk and fetched on navigation, keeping the landing page's
// initial JS (and CSS) small.
const Progress = lazy(() => import('./progress/Progress'))
const Books = lazy(() => import('./books/Books'))
const Settings = lazy(() => import('./settings/Settings'))
const Flip = lazy(() => import('./flip/Flip'))
const Results = lazy(() => import('./results/Results'))
const Login = lazy(() => import('./login/Login'))

function HomeIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M3 10.2 12 3l9 7.2" />
      <path d="M5 9.5V20h14V9.5" />
      <path d="M9.5 20v-5.5h5V20" />
    </svg>
  )
}

function ProgressIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M4 19V5" />
      <path d="M4 19h16" />
      <path d="M8 16v-4" />
      <path d="M12.5 16V8" />
      <path d="M17 16v-6.5" />
    </svg>
  )
}

function BooksIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 6.5C10.5 5.2 8.3 4.5 5.5 4.5H4v14h1.5c2.8 0 5 .7 6.5 2" />
      <path d="M12 6.5c1.5-1.3 3.7-2 6.5-2H20v14h-1.5c-2.8 0-5 .7-6.5 2" />
      <path d="M12 6.5v14" />
    </svg>
  )
}

function GearIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="3.2" />
      <path d="M12 3v2M12 19v2M4.2 7.5l1.7 1M18.1 15.5l1.7 1M4.2 16.5l1.7-1M18.1 8.5l1.7-1" />
    </svg>
  )
}

const NAV_ITEMS: CapsuleNavItem[] = [
  { id: 'home', label: 'Home', icon: <HomeIcon /> },
  { id: 'progress', label: 'Progress', icon: <ProgressIcon /> },
  { id: 'books', label: 'Wordbooks', icon: <BooksIcon /> },
  { id: 'settings', label: 'Settings', icon: <GearIcon /> },
]

const NAV_PATH: Record<string, string> = {
  home: '/',
  progress: '/progress',
  books: '/books',
  settings: '/settings',
}

/** Study page for the book in the URL. */
function StudyRoute() {
  const { book } = useParams()
  const navigate = useNavigate()
  return (
    <Flip
      book={book ?? DEFAULT_BOOK}
      onBack={() => navigate('/')}
      onFinish={() => navigate('/results')}
    />
  )
}

/** `/study` with no book lands on the synced active book. */
function StudyRedirect() {
  const { settings } = useSettings()
  return <Navigate to={`/study/${settings.activeBook ?? DEFAULT_BOOK}`} replace />
}

function App() {
  const navigate = useNavigate()
  const location = useLocation()
  const { pathname } = location
  const { settings } = useSettings()
  const activeBook = settings.activeBook ?? DEFAULT_BOOK
  // Where to return after closing the login overlay (set by whoever opened it).
  const loginFrom =
    (location.state as { from?: string } | null)?.from ?? '/'

  // The nav rail is hidden on full-bleed pages.
  const bare =
    pathname.startsWith('/study') ||
    pathname === '/results' ||
    pathname === '/login'
  const activeId =
    Object.keys(NAV_PATH).find((id) => NAV_PATH[id] === pathname) ?? 'home'

  const home = (
    <Home
      rail
      onStudy={() => navigate(`/study/${activeBook}`)}
      onChangeBook={() => navigate('/books')}
      onLogin={() => navigate('/login')}
    />
  )

  // Page to render behind the login overlay (the page that opened it).
  const pageFor = (path: string) => {
    if (path === '/progress') return <Progress rail />
    if (path === '/books') return <Books rail />
    if (path === '/settings') return <Settings rail />
    return home
  }

  return (
    <>
      {!bare && (
        <CapsuleNav
          items={NAV_ITEMS}
          active={activeId}
          onSelect={(id) => navigate(NAV_PATH[id] ?? '/')}
        />
      )}

      <Suspense fallback={<div className="route-loading" />}>
        <Routes>
          <Route path="/" element={home} />
          <Route path="/login" element={pageFor(loginFrom)} />
          <Route path="/progress" element={<Progress rail />} />
          <Route path="/books" element={<Books rail />} />
          <Route path="/settings" element={<Settings rail />} />
          <Route path="/study" element={<StudyRedirect />} />
          <Route path="/study/:book" element={<StudyRoute />} />
          <Route
            path="/results"
            element={
              <Results
                onContinue={() => navigate(`/study/${activeBook}`)}
                onStop={() => navigate('/')}
              />
            }
          />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>

        {pathname === '/login' && (
          <Login onClose={() => navigate(loginFrom, { replace: true })} />
        )}
      </Suspense>
    </>
  )
}

export default App
