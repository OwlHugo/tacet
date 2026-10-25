import type { SearchHit } from '@tacet/core'
import type { MeetingSummary } from '../../shared/contract.ts'
import { day, duration, time } from './format.ts'

function SearchIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <circle cx="7" cy="7" r="5" stroke="currentColor" strokeWidth="1.5" />
      <path d="M11 11l3 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  )
}

export function SearchBox(props: {
  value: string
  onChange: (q: string) => void
  inputRef: React.Ref<HTMLInputElement>
  hint: string
}) {
  return (
    <div className="search">
      <SearchIcon />
      <input
        ref={props.inputRef}
        value={props.value}
        onChange={(e) => props.onChange(e.target.value)}
        placeholder="Search meetings"
        spellCheck={false}
        aria-label="Search meetings"
      />
      <kbd>{props.hint}</kbd>
    </div>
  )
}

export function SearchResults({
  hits,
  onOpen,
}: {
  hits: readonly SearchHit[]
  onOpen: (id: string, at?: number) => void
}) {
  if (hits.length === 0) return <p className="muted pad">No matches.</p>
  return hits.map((h) => (
    <button
      type="button"
      key={`${h.meetingId}-${h.where}-${h.at}-${h.text}`}
      className="item hit"
      onClick={() => onOpen(h.meetingId, h.where === 'title' ? undefined : h.at)}
    >
      <span className="item-meta">
        {h.title} · <span className="accent">{h.timestamp}</span> · {h.where}
      </span>
      <span className="hit-text">{h.text}</span>
    </button>
  ))
}

export function MeetingList(props: {
  meetings: readonly MeetingSummary[]
  selected: string | undefined
  onOpen: (id: string) => void
}) {
  if (props.meetings.length === 0) return <p className="muted pad">No meetings yet.</p>
  return props.meetings.map((m) => (
    <button
      type="button"
      key={m.id}
      className={`item ${m.id === props.selected ? 'active' : ''}`}
      onClick={() => props.onOpen(m.id)}
    >
      <span className="item-title">{m.title}</span>
      <span className="item-meta">
        {day(m.date)} · {time(m.date)} · {duration(m.duration)}
        {m.actionItems > 0 ? ` · ${m.actionItems} ${m.actionItems === 1 ? 'task' : 'tasks'}` : ''}
      </span>
    </button>
  ))
}
