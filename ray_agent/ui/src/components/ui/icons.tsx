import type {ComponentType, ReactNode, SVGProps} from 'react'

type IconProps = SVGProps<SVGSVGElement> & {size?: number | string}
export type UiIcon = ComponentType<IconProps>

/** Navigation and action shapes follow the approved prototype; supplemental shapes use the same grid. */
function lineIcon(drawing: ReactNode): UiIcon {
  return function Icon({size = 24, ...props}: IconProps) {
    return <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor"
      strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>{drawing}</svg>
  }
}
export const Mic = lineIcon(<><rect x="9" y="3" width="6" height="12" rx="3"/><path d="M5 11v1a7 7 0 0 0 14 0v-1M12 19v3m-4 0h8"/></>)
export const Activity = lineIcon(<path d="M3.5 13c2.2 0 2.2-4 4.3-4s2.1 6 4.2 6 2.1-6 4.2-6 2.1 4 4.3 4"/>)
export const AlertCircle = lineIcon(<><circle cx="12" cy="12" r="8.5"/><path d="M12 8v4m0 3v.1"/></>)
export const AlertTriangle = lineIcon(<><path d="M12 4 21 19.5H3Z"/><path d="M12 10v4M12 17v.01"/></>)
export const AlignLeft = lineIcon(<path d="M4.5 6h15m-15 4h10m-10 4h15m-15 4h10"/>)
export const Archive = lineIcon(<path d="M5 9v10h14V9m-15 0V5h16v4ZM10 13h4"/>)
export const ArchiveRestore = lineIcon(<path d="M5 9v10h14V9m-15 0V5h16v4Zm8 7v-5m-2 2 2-2 2 2"/>)
export const ArrowDown = lineIcon(<path d="M12 5v14M6 13l6 6 6-6"/>)
export const ArrowLeft = lineIcon(<path d="M20 12H4m7-7-7 7 7 7"/>)
export const ArrowRight = lineIcon(<path d="M4 12h16m-7-7 7 7-7 7"/>)
export const ArrowUp = lineIcon(<path d="M12 19V5M6 11l6-6 6 6"/>)
export const ArrowUpRight = lineIcon(<path d="M6 18 18 6M9 6h9v9"/>)
export const BookOpen = lineIcon(<path d="M12 6c-2-1.5-5-2-8-1v13c3-1 6-.5 8 1 2-1.5 5-2 8-1V5c-3-1-6-.5-8 1Zm0 0v13"/>)
export const Bookmark = lineIcon(<path d="M7 4.5h10v15l-5-3.5-5 3.5Z"/>)
export const Check = lineIcon(<path d="m5 12.5 4.5 4.5L19 7.5"/>)
export const ChevronDown = lineIcon(<path d="m6 9.5 6 6 6-6"/>)
export const ChevronLeft = lineIcon(<path d="m14.5 6-6 6 6 6"/>)
export const ChevronRight = lineIcon(<path d="m9.5 6 6 6-6 6"/>)
export const ChevronUp = lineIcon(<path d="m6 14.5 6-6 6 6"/>)
export const Circle = lineIcon(<circle cx="12" cy="12" r="8.5"/>)
export const CircleCheck = lineIcon(<><circle cx="12" cy="12" r="8.5"/><path d="m8 12 2.8 2.8L16 9.5"/></>)
export const CircleDot = lineIcon(<><circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="2" fill="currentColor" stroke="none"/></>)
export const CirclePause = lineIcon(<><circle cx="12" cy="12" r="8.5"/><path d="M10 9v6m4-6v6"/></>)
export const CircleStop = lineIcon(<><circle cx="12" cy="12" r="8.5"/><rect x="9" y="9" width="6" height="6" rx="1"/></>)
export const CircleX = lineIcon(<><circle cx="12" cy="12" r="8.5"/><path d="m9 9 6 6m0-6-6 6"/></>)
export const ClipboardList = lineIcon(<><rect x="8" y="3.5" width="8" height="4" rx="1"/><path d="M8 5.5H6a1.5 1.5 0 0 0-1.5 1.5v12A1.5 1.5 0 0 0 6 20.5h12a1.5 1.5 0 0 0 1.5-1.5V7A1.5 1.5 0 0 0 18 5.5h-2m-7 6h6m-6 4h6"/></>)
export const Clock3 = lineIcon(<><circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/></>)
export const Code2 = lineIcon(<path d="m8 7-5 5 5 5m8-10 5 5-5 5m-2-13-4 16"/>)
export const Compass = lineIcon(<><circle cx="12" cy="12" r="8.5"/><path d="m15.5 8.5-2 5-5 2 2-5Z"/></>)
export const Copy = lineIcon(<><rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/></>)
export const Dot = lineIcon(<circle cx="12" cy="12" r="3.5" fill="currentColor" stroke="none"/>)
export const Download = lineIcon(<path d="M12 4v11M7 10.5l5 5 5-5M5 19.5h14"/>)
export const Expand = lineIcon(<path d="M14.5 4.5h5v5M9.5 19.5h-5v-5M19.5 4.5 13.5 10.5M4.5 19.5l6-6"/>)
export const ExternalLink = lineIcon(<path d="M13 4h7v7m0-7-9 9m7 0v5a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h5"/>)
export const Eye = lineIcon(<><path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z"/><circle cx="12" cy="12" r="3"/></>)
export const File = lineIcon(<><path d="M6.5 3.5h7.5l4.5 4.5v12.5h-12Z"/><path d="M13.5 3.5V8.5h5"/></>)
export const FileText = lineIcon(<><path d="M6.5 3.5h7.5l4.5 4.5v12.5h-12Z"/><path d="M13.5 3.5V8.5h5M9 12.5h6M9 16h6"/></>)
export const Finder = lineIcon(<><rect x="3.5" y="4.5" width="17" height="15" rx="3"/><path d="M12 4.5c-1.4 3.5-1.8 7-.8 10.5M8.5 9.5v1M15.5 9.5v1M8 15.5c2.4 1.4 5.6 1.4 8 0"/></>)
export const Folder = lineIcon(<path d="M3.5 7.5A2 2 0 0 1 5.5 5.5h3.6l2 2.2h7.4a2 2 0 0 1 2 2v7.8a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2Z"/>)
export const FolderOpen = lineIcon(<><path d="M3.5 17V7.5a2 2 0 0 1 2-2h3.6l2 2.2h6.4a2 2 0 0 1 2 2V11"/><path d="M3.5 17.5 6 11.8a1.6 1.6 0 0 1 1.5-1h12a1 1 0 0 1 .9 1.4l-2.3 5.4a1.6 1.6 0 0 1-1.5 1H5a1.5 1.5 0 0 1-1.5-1.1Z"/></>)
export const FolderPlus = lineIcon(<path d="M3.5 9V7a2 2 0 0 1 2-2h4l2 2h7a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2Zm5 4h7m-3.5-3.5v7"/>)
export const FolderSearch = lineIcon(<><path d="M12 17H6a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h3l2 2h7a2 2 0 0 1 2 2v1"/><circle cx="16" cy="15" r="3.5"/><path d="m18.5 17.5 2 2"/></>)
export const FolderX = lineIcon(<path d="M3.5 9V7a2 2 0 0 1 2-2h4l2 2h7a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2Zm6 1.5 5 5m0-5-5 5"/>)
export const Gauge = lineIcon(<><path d="M4.5 16.5a8 8 0 1 1 15 0"/><path d="m12 13 3.5-4"/></>)
export const Globe = lineIcon(<><circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17M12 3.5c2.5 2.6 3.6 5.5 3.6 8.5s-1.1 5.9-3.6 8.5c-2.5-2.6-3.6-5.5-3.6-8.5S9.5 6.1 12 3.5Z"/></>)
export const Grip = lineIcon(<><circle cx="9" cy="6.5" r="1.1"/><circle cx="15" cy="6.5" r="1.1"/><circle cx="9" cy="12" r="1.1"/><circle cx="15" cy="12" r="1.1"/><circle cx="9" cy="17.5" r="1.1"/><circle cx="15" cy="17.5" r="1.1"/></>)
export const Hexagon = lineIcon(<><path d="M12 3.5 19.5 7.8v8.4L12 20.5 4.5 16.2V7.8Z"/><path d="M12 8.5v7M8.8 10.2l6.4 3.6M15.2 10.2l-6.4 3.6"/></>)
export const History = lineIcon(<><path d="M4.5 12a7.5 7.5 0 1 0 2.2-5.3L4.5 9"/><path d="M4.5 4.5V9H9"/><path d="M12 8v4.2l2.8 1.8"/></>)
export const Hourglass = lineIcon(<path d="M6 4h12M6 20h12M8 4v3l4 5 4-5V4M8 20v-3l4-5 4 5v3"/>)
export const Inbox = lineIcon(<><path d="M3.5 13.5 6 5.5h12l2.5 8V18a1.5 1.5 0 0 1-1.5 1.5H5A1.5 1.5 0 0 1 3.5 18Z"/><path d="M3.5 13.5h5l1.2 2.2h4.6l1.2-2.2h5"/></>)
export const Info = lineIcon(<><circle cx="12" cy="12" r="8.5"/><path d="M12 11v5m0-8v.1"/></>)
export const Layers = lineIcon(<><path d="m12 4 8.5 4.5L12 13 3.5 8.5Z"/><path d="m3.5 12.5 8.5 4.5 8.5-4.5"/><path d="m3.5 16.5 8.5 4.5 8.5-4.5" opacity=".55"/></>)
export const Library = lineIcon(<><path d="M5 4.5v15M9 4.5v15"/><path d="m13.2 5.2 3.6-.9 3.4 14.4-3.6.9Z"/></>)
export const Link2 = lineIcon(<path d="m10 8 2-2a4 4 0 0 1 6 6l-2 2m-2 2-2 2a4 4 0 0 1-6-6l2-2m2 4 4-4"/>)
export const List = lineIcon(<><path d="M9 7h11M9 12h11M9 17h11"/><circle cx="4.8" cy="7" r=".9"/><circle cx="4.8" cy="12" r=".9"/><circle cx="4.8" cy="17" r=".9"/></>)
export const ListChecks = lineIcon(<path d="m3.5 7 1.6 1.6L8 5.7M3.5 15l1.6 1.6L8 13.7M11.5 7H20M11.5 15H20"/>)
export const ListFilter = lineIcon(<path d="M4.5 6h15m-12 6h9m-6 6h3"/>)
export const LoaderCircle = lineIcon(<path d="M20.5 12a8.5 8.5 0 1 1-8.5-8.5"/>)
export const MessageCircle = lineIcon(<path d="M7.5 18.5 4 20l1-3.6A7.5 7.5 0 1 1 7.5 18.5Z"/>)
export const MessageCircleQuestion = lineIcon(<><path d="M7.5 18.5 4 20l1-3.6A7.5 7.5 0 1 1 7.5 18.5Z"/><path d="M10 9a2 2 0 1 1 2 2v1m0 2v.1"/></>)
export const MessagesSquare = lineIcon(<><path d="M14 9.5a5.5 5.5 0 0 1-8.2 4.8L3 15l.8-2.6A5.5 5.5 0 1 1 14 9.5Z"/><path d="M10.6 17.6A5.5 5.5 0 0 0 18.2 19L21 20l-.8-2.6a5.5 5.5 0 0 0-3.4-8.2"/></>)
export const Minus = lineIcon(<path d="M5 12h14"/>)
export const Monitor = lineIcon(<><rect x="3.5" y="5" width="17" height="12" rx="2"/><path d="M12 17v3m-4 0h8"/></>)
export const Moon = lineIcon(<path d="M19.5 14.5A7.5 7.5 0 0 1 9.5 4.5a7.5 7.5 0 1 0 10 10Z"/>)
export const MoreHorizontal = lineIcon(<><circle cx="6" cy="12" r="1.2"/><circle cx="12" cy="12" r="1.2"/><circle cx="18" cy="12" r="1.2"/></>)
export const Package = lineIcon(<><path d="M12 3 20 7.5v9L12 21l-8-4.5v-9Z"/><path d="m4 7.5 8 4.5 8-4.5M12 12v9"/></>)
export const PanelLeftIcon = lineIcon(<><rect x="3.5" y="4.5" width="17" height="15" rx="3"/><path d="M9.5 4.5v15"/></>)
export const PanelRight = lineIcon(<><rect x="3.5" y="4.5" width="17" height="15" rx="3"/><path d="M14.5 4.5v15"/></>)
export const Paperclip = lineIcon(<path d="m19 11.5-7 7a4.6 4.6 0 0 1-6.5-6.5l7.4-7.4a3 3 0 0 1 4.3 4.3l-7.3 7.3a1.5 1.5 0 0 1-2.1-2.1l6.6-6.6"/>)
export const Pencil = lineIcon(<><path d="M14.5 5.5 18.5 9.5 9 19H5v-4Z"/><path d="m12.5 7.5 4 4"/></>)
export const Pin = lineIcon(<><path d="M9 4.5h6l-1 5 3.5 3v1.5h-11V12.5l3.5-3Z"/><path d="M12 14.5V20"/></>)
export const PinOff = lineIcon(<path d="m4 4 16 16M9 5h6l-1 4.5 3.5 3V14m-8-4.5-3 3v2H14m-2 0V20"/>)
export const Play = lineIcon(<path d="m8 5 11 7-11 7Z"/>)
export const Plus = lineIcon(<path d="M12 5v14M5 12h14"/>)
export const Quote = lineIcon(<path d="M5 17.5c1.8-.5 3-2 3-4.5V8.5H4.5V13H8M14 17.5c1.8-.5 3-2 3-4.5V8.5h-3.5V13H17"/>)
export const RefreshCw = lineIcon(<path d="M20 4v5h-5m4.1-.3A7.5 7.5 0 0 0 5 11m-1 9v-5h5m-4.1.3A7.5 7.5 0 0 0 19 13"/>)
export const Repeat2 = lineIcon(<path d="M4.5 11V9.5a3 3 0 0 1 3-3h11l-3-3M19.5 13v1.5a3 3 0 0 1-3 3h-11l3 3"/>)
export const ScrollText = lineIcon(<path d="M7 5h10a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H8m-1-2V7a2 2 0 0 0-4 0v2h4m3 0h6m-6 4h6m-7 4h7"/>)
export const Search = lineIcon(<><circle cx="11" cy="11" r="6.5"/><path d="m16 16 4 4"/></>)
export const Settings = lineIcon(<><path d="M4 7h9M17 7h3M4 17h3M11 17h9"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="17" r="2"/></>)
export const Shield = lineIcon(<path d="M12 3.5 19 6v5.5c0 4.3-3 7.6-7 9-4-1.4-7-4.7-7-9V6Z"/>)
export const ShieldCheck = lineIcon(<><path d="M12 3.5 19 6v5.5c0 4.3-3 7.6-7 9-4-1.4-7-4.7-7-9V6Z"/><path d="m9 12 2 2 4-4"/></>)
export const ShieldQuestion = lineIcon(<><path d="M12 3.5 19 6v5.5c0 4.3-3 7.6-7 9-4-1.4-7-4.7-7-9V6Z"/><path d="M10 9a2 2 0 1 1 2 2v1m0 3v.1"/></>)
export const Sparkles = lineIcon(<path d="M12 3.5 13.7 9a2 2 0 0 0 1.3 1.3l5.5 1.7-5.5 1.7a2 2 0 0 0-1.3 1.3L12 20.5 10.3 15A2 2 0 0 0 9 13.7L3.5 12 9 10.3A2 2 0 0 0 10.3 9Z"/>)
export const Square = lineIcon(<rect x="4" y="4" width="16" height="16" rx="3"/>)
export const Stop = lineIcon(<rect x="7" y="7" width="10" height="10" rx="2"/>)
export const Sun = lineIcon(<><circle cx="12" cy="12" r="3.6"/><path d="M12 3v1.6M12 19.4V21M3 12h1.6M19.4 12H21M5.6 5.6l1.1 1.1M17.3 17.3l1.1 1.1M5.6 18.4l1.1-1.1M17.3 6.7l1.1-1.1"/></>)
export const Terminal = lineIcon(<><rect x="3.5" y="4.5" width="17" height="15" rx="3"/><path d="m7.5 9.5 3 2.5-3 2.5M12.5 15h4"/></>)
export const Trash = lineIcon(<path d="M4.5 7h15M9 7V4.5h6V7M6.5 7l1 12h9l1-12m-7 3v5.5m3-5.5v5.5"/>)
export const Undo2 = lineIcon(<><path d="M9 14 4.5 9.5 9 5"/><path d="M4.5 9.5H14a5.5 5.5 0 0 1 0 11h-2"/></>)
export const Upload = lineIcon(<path d="M12 16V4m-5 5 5-5 5 5M5 17v2.5h14V17"/>)
export const Wand = lineIcon(<path d="m4.5 19.5 10-10M13 6l1-2.5L15 6l2.5 1L15 8l-1 2.5L13 8l-2.5-1ZM18.5 13l.6-1.5.6 1.5 1.5.6-1.5.6-.6 1.5-.6-1.5-1.5-.6Z"/>)
export const X = lineIcon(<path d="M6.5 6.5 17.5 17.5M17.5 6.5 6.5 17.5"/>)
export const CheckIcon = Check
export const ChevronRightIcon = ChevronRight
export const CircleCheckIcon = CircleCheck
export const CircleIcon = Circle
export const Code = Code2
export const InfoIcon = Info
export const Loader2 = LoaderCircle
export const Loader2Icon = LoaderCircle
export const SearchIcon = Search
export const SlidersHorizontal = Settings
export const SquareArrowOutUpRight = ExternalLink
export const SquareTerminal = Terminal
export const Trash2 = Trash
export const TriangleAlert = AlertTriangle
export const TriangleAlertIcon = AlertTriangle
export const XCircle = CircleX
export const XIcon = X

export const Ban = lineIcon(<><circle cx="12" cy="12" r="8.5"/><path d="m6 6 12 12"/></>)
export const Bot = lineIcon(<><rect x="4.5" y="8" width="15" height="11" rx="3"/><path d="M12 8V4m-3 8v1m6-1v1m-5 3h4"/></>)
export const Cable = lineIcon(<path d="M5 7v3h5V7M6.5 7V4M8.5 7V4m-1 6v5a4.5 4.5 0 0 0 9 0v-1m-2 0h4v-3h-4Z"/>)
export const CircleDashed = lineIcon(<circle cx="12" cy="12" r="8.5" strokeDasharray="3 3"/>)
export const CircleMinus = lineIcon(<><circle cx="12" cy="12" r="8.5"/><path d="M8 12h8"/></>)
export const Coins = lineIcon(<><ellipse cx="9" cy="7" rx="5" ry="2.5"/><path d="M4 7v7c0 1.4 2.2 2.5 5 2.5m-5-6c0 1.4 2.2 2.5 5 2.5"/><ellipse cx="16" cy="14" rx="4" ry="2"/><path d="M12 14v4c0 1.1 1.8 2 4 2s4-.9 4-2v-4"/></>)
export const CornerDownRight = lineIcon(<path d="M5 5v6a4 4 0 0 0 4 4h10m-4-4 4 4-4 4"/>)
export const FileArchive = lineIcon(<><path d="M6 4h8l4 4v12H6Zm7 0v4h5m-7-2h1m-1 3h1m-1 3h1"/><rect x="10" y="15" width="4" height="3" rx=".75"/></>)
export const FileCode = lineIcon(<path d="M6 4h8l4 4v12H6Zm7 0v4h5m-8 4-2 2 2 2m4-4 2 2-2 2"/>)
export const FileCog = lineIcon(<><path d="M6 4h8l4 4v12H6Zm7 0v4h5m-6 3v1m0 4v1m-3-3h1m4 0h1"/><circle cx="12" cy="14" r="2"/></>)
export const FileImage = lineIcon(<><path d="M6 4h8l4 4v12H6Zm7 0v4h5m-10 9 3-3 2 2 1.5-1.5L17 17"/><circle cx="10" cy="11.5" r=".6"/></>)
export const FileJson = lineIcon(<path d="M6 4h8l4 4v12H6Zm7 0v4h5m-7 3c-1 0-1.5.6-1.5 1.5v.5L8 14l1.5 1v.5c0 .9.5 1.5 1.5 1.5m2-6c1 0 1.5.6 1.5 1.5v.5l1.5 1-1.5 1v.5c0 .9-.5 1.5-1.5 1.5"/>)
export const FileQuestion = lineIcon(<path d="M6 4h8l4 4v12H6Zm7 0v4h5m-8 4a2 2 0 1 1 2 2v1m0 2v.1"/>)
export const FileSearch = lineIcon(<><path d="M11 20H6V4h8l4 4v2m-5-6v4h5"/><circle cx="15.5" cy="15" r="3"/><path d="m18 17.5 2.5 2.5"/></>)
export const FileSpreadsheet = lineIcon(<path d="M6 4h8l4 4v12H6Zm7 0v4h5m-9 3h6v6H9Zm3 0v6m-3-3h6"/>)
export const Files = lineIcon(<path d="M4 15V4h10m-6 4h7l4 4v8H8Zm7 0v4h4"/>)
export const Github = lineIcon(<path d="M9 19c-3 .7-3.5-1.5-5-2m11 4v-3.2c0-1-.4-1.7-.9-2.2 3.1-.4 5-1.5 5-4.8 0-1.2-.4-2.1-1.1-2.9.2-.6.3-1.7-.1-3-.7-.1-1.7.2-3 .9a11.4 11.4 0 0 0-5.7 0c-1.3-.7-2.3-1-3-.9-.4 1.3-.3 2.4-.1 3C5.4 8.7 5 9.6 5 10.8c0 3.3 1.9 4.4 5 4.8-.6.5-1 1.2-1 2.2V21"/>)
export const ListTree = lineIcon(<path d="M6 5v13h4m-4-6h4m2-6h8m-8 6h8m-8 6h8"/>)
export const Minimize2 = lineIcon(<path d="M5 5l6 6m-5 0h5V6m8 13-6-6m5 0h-5v5"/>)
export const OctagonXIcon = lineIcon(<path d="m8.5 4-4.5 4.5v7l4.5 4.5h7l4.5-4.5v-7L15.5 4Zm1 5.5 5 5m0-5-5 5"/>)
export const PackageOpen = lineIcon(<path d="m12 8 7.8-4 2.2 4-7.8 4L12 8l-2.2 4L2 8l2.2-4Zm-8 3v6l8 4 8-4v-6m-8 2v8"/>)
export const Palette = lineIcon(<><path d="M20.5 12a8.5 8.5 0 1 0-8.5 8.5c1.3 0 2-.8 2-1.7 0-.8-.7-1.2-.7-2 0-1.5 1.4-2.2 3.2-2.2 2.1 0 4-1 4-2.6Z"/><path d="M7 13v.1M8 8.5v.1m4-2v.1m4 2v.1"/></>)
export const Plug = lineIcon(<path d="M7 9h10v3a5 5 0 0 1-10 0Zm2-5v5m6-5v5m-3 8v3"/>)
export const RotateCcw = lineIcon(<path d="M4.5 11a7.5 7.5 0 1 1 2.2 6.5M4.5 11V5m0 6h6"/>)
export const RotateCw = lineIcon(<path d="M19.5 11a7.5 7.5 0 1 0-2.2 6.5m2.2-6.5V5m0 6h-6"/>)
export const Scan = lineIcon(<path d="M4 9V4h5m6 0h5v5m0 6v5h-5m-6 0H4v-5m3-3h10"/>)
export const SquareDashed = lineIcon(<rect x="4" y="4" width="16" height="16" rx="3" strokeDasharray="3 3"/>)
export const Unplug = lineIcon(<path d="m4 4 16 16M7 9v3a5 5 0 0 0 5 5v3M17 9v3m-8-8v2m6-2v5h2"/>)
export const Wrench = lineIcon(<path d="M15 4a5 5 0 0 0-5.3 6.6l-5.1 5.1a2.2 2.2 0 0 0 3.1 3.1l5.1-5.1a5 5 0 0 0 6.6-5.3L16 11l-3-3Z"/>)
export const FileCode2 = FileCode
export const ListTodo = ListChecks
