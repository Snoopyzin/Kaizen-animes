import { BRAND } from '../brand'
import KaizenLogo from '../components/KaizenLogo'

// Full-screen dark layout shared by the language, login and subscription screens.
// The app has no native title bar, so the empty background is a drag area (move the window by it,
// e.g. to another monitor); everything interactive is marked "nodrag".
export default function AuthShell({ children, top }) {
  return (
    <div className="draggable relative flex min-h-screen flex-col items-center justify-center overflow-hidden bg-[#111113] px-4 py-10 text-white">
      <div
        className="stroke-text pointer-events-none absolute left-0 top-[-3rem] w-full select-none overflow-hidden text-nowrap font-inter text-[16rem] leading-none"
        aria-hidden
      >
        {BRAND.jp}
        {BRAND.jp}
        {BRAND.jp}
      </div>
      <div
        className="stroke-text pointer-events-none absolute bottom-[-3rem] left-0 w-full select-none overflow-hidden text-nowrap font-inter text-[16rem] leading-none"
        aria-hidden
      >
        {BRAND.name.toUpperCase()} {BRAND.name.toUpperCase()}
      </div>
      {/* right-44 keeps it clear of the native minimize / maximize / close buttons */}
      {top && <div className="nodrag absolute right-44 top-3 z-10">{top}</div>}
      <div className="nodrag relative z-10 flex w-full max-w-md flex-col items-center gap-y-6">
        <KaizenLogo size={84} />
        {children}
      </div>
    </div>
  )
}
