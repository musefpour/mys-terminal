export function XMark() {
  return (
    <svg className="xmark" viewBox="0 0 12 12" aria-hidden="true" focusable="false">
      <path d="M2.25 2.25l7.5 7.5M9.75 2.25l-7.5 7.5" />
    </svg>
  )
}

export function CloseButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button type="button" className="icon-x" title={label} aria-label={label} onClick={onClick}>
      <XMark />
    </button>
  )
}
