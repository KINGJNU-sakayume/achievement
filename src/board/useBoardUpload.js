import { useCallback, useEffect, useRef, useState } from 'react'
import { browserDeps } from '@/lifehub/remote.js'
import { boardEnabled, boardNeedsReconnect, clearBoardReconnect, maybeUploadBoard, setBoardEnabled } from './upload.js'

const CHANGE_DEBOUNCE_MS = 3000

/**
 * Keeps the board tile list on Life Hub up to date (src/board/upload.js decides whether anything is sent).
 * Tries after a change, when the app opens, when it becomes visible again, and when a waiting upload is due.
 */
export function useBoardUpload({ records, achievements, categories, connected }) {
  const [enabled, setEnabledState] = useState(() => boardEnabled(browserDeps()))
  const [needsReconnect, setNeedsReconnect] = useState(() => boardNeedsReconnect(browserDeps()))
  const inputRef = useRef({ records, achievements, categories })
  inputRef.current = { records, achievements, categories }
  const timer = useRef(null)

  const run = useCallback(async () => {
    const deps = browserDeps()
    const result = await maybeUploadBoard(inputRef.current, deps)
    setNeedsReconnect(boardNeedsReconnect(deps))
    clearTimeout(timer.current)
    if (result.retryInMs) timer.current = setTimeout(run, result.retryInMs + 1000)
  }, [])

  // After any change to what the tiles are made of (several changes in a row count as one).
  useEffect(() => {
    const id = setTimeout(run, CHANGE_DEBOUNCE_MS)
    return () => clearTimeout(id)
  }, [achievements, records, categories, connected, enabled, run])

  // Opening the app and coming back to it: sends what was left over, and the daily refresh.
  useEffect(() => {
    run()
    const onVisible = () => { if (document.visibilityState === 'visible') run() }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      document.removeEventListener('visibilitychange', onVisible)
      clearTimeout(timer.current)
    }
  }, [run])

  const setEnabled = useCallback((on) => {
    setBoardEnabled(browserDeps(), on)
    setEnabledState(on)
  }, [])

  /** A new sign-in carries the board scope, so uploading may start again. */
  const reconnected = useCallback(() => {
    clearBoardReconnect(browserDeps())
    setNeedsReconnect(false)
  }, [])

  return { boardEnabled: enabled, setBoardEnabled: setEnabled, boardNeedsReconnect: needsReconnect, boardReconnected: reconnected }
}
