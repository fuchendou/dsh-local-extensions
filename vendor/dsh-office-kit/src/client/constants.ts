/** Locale namespace and slash source owned by this plugin. */
export const OFFICE_NS = 'dsh-office-kit'
export const OFFICE_SOURCE = 'office'
export const OFFICE_CHIP = 'office'
export const OFFICE_CHIP_SLOT = 'conversation.user.text.node'

/** Additive, session-scoped toolbar contribution inside the official file preview. */
export const ANNOTATION_SLOT = 'sidebar.right.tab.document.actions'
export const ANNOTATION_ID = 'office-annotations'
export const ANNOTATION_ORDER = 20
export const ANNOTATION_PRIORITY = 100
export const ANNOTATION_NODE = 'officeAnnotation'
export const ANNOTATION_OPEN = '<office-annotations>'
export const ANNOTATION_CLOSE = '</office-annotations>'
export const OFFICE_STYLE_ID = 'dsh-office-kit/reference.css'
export const FILE_ADDRESS_PREFIX = 'dsh-resource://file/'
export const SESSION_FILE_PREFIX = `${FILE_ADDRESS_PREFIX}session/`

/** Only semantic selectors: no dependency on another plugin's CSS/data attributes. */
export const ANNOTATION_CANVAS_SELECTOR = 'canvas[role="img"][aria-label]'
/** Spreadsheet previews paint one grid canvas instead of paged PDF surfaces. */
export const ANNOTATION_SPREADSHEET_CANVAS_SELECTOR = 'canvas.fortune-sheet-canvas'
/** Gravity UI Icons 2.21.0 CommentFill (MIT); original retained in assets/icons/comment-fill.svg. */
export const ANNOTATION_CURSOR = `url("data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" fill="none" viewBox="0 0 16 16"><path fill="#466eff" fill-rule="evenodd" d="M8 13c3.866 0 7-2 7-6s-3.134-6-7-6-7 2-7 6c0 2.16.914 3.737 2.364 4.73l.09 2.161a1.157 1.157 0 0 0 1.857.872l2.322-1.77Q7.816 13 8 13" clip-rule="evenodd"/></svg>')}") 4 18, crosshair`
export const ANNOTATION_HOLD_MS = 350
export const ANNOTATION_MIN_REGION = 6
export const ANNOTATION_PADDING = 3
export const ANNOTATION_HIT_X = 8
export const ANNOTATION_HIT_Y = 4
export const ANNOTATION_MAX_ITEMS = 50
export const ANNOTATION_MAX_TEXT = 20000
export const ANNOTATION_MAX_PAYLOAD = 1200000
export const ANNOTATION_MAX_PIXELS = 4000000
