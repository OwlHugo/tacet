import type { Meeting } from '@tacet/core'
import { type ReactNode, useCallback, useEffect, useState } from 'react'
import { day, duration, time, timestamp } from './format.ts'
import { api } from './platform.ts'

function Block({
  title,
  empty,
  children,
}: {
  title: string
  empty: string
  children: ReactNode[]
}) {
  return (
    <div className="block">
      <h3>{title}</h3>
      {children.length > 0 ? <ul>{children}</ul> : <p className="muted">{empty}</p>}
    </div>
  )
}

function Row({
  at,
  onJump,
  check,
  children,
}: {
  at: number
  onJump: () => void
  check?: boolean
  children: ReactNode
}) {
  return (
    <li className={check ? 'check' : ''}>
      {check && <span className="box" />}
      <span className="row-text">{children}</span>
      <button
        type="button"
        className="stamp"
        onClick={onJump}
        title="Jump to the source in the transcript"
      >
        {timestamp(at)}
      </button>
    </li>
  )
}

function Minutes({
  minutes,
  jump,
}: {
  minutes: NonNullable<Meeting['minutes']>
  jump: (id: number) => void
}) {
  const first = (segments: readonly [number, ...number[]]) => () => jump(segments[0])
  // A dropped deadline leaves its task in the minutes: it is not an item that went missing.
  const madeUp = minutes.rejected.filter((r) => r.kind !== 'deadline').length
  return (
    <>
      <Block title="Summary" empty="Nothing to summarize.">
        {minutes.summary.map((p) => (
          <Row key={`${p.at}-${p.text}`} at={p.at} onJump={first(p.segments)}>
            {p.text}
          </Row>
        ))}
      </Block>
      <Block title="Decisions" empty="No decisions in the transcript.">
        {minutes.decisions.map((d) => (
          <Row key={`${d.at}-${d.text}`} at={d.at} onJump={first(d.segments)}>
            {d.text}
          </Row>
        ))}
      </Block>
      <Block title="Action items" empty="No action items in the transcript.">
        {minutes.actionItems.map((a) => (
          <Row key={`${a.at}-${a.task}`} at={a.at} onJump={first(a.segments)} check>
            {a.task} <span className="owner">{a.owner}</span>
            {a.due && <span className="due">{a.due}</span>}
          </Row>
        ))}
      </Block>
      <p className="footnote">
        Every line links to the transcript.{' '}
        {madeUp > 0 ? `${madeUp} item(s) the model made up were dropped. ` : ''}
        Written by {minutes.model} on this machine.
      </p>
    </>
  )
}

function stats(m: Meeting): string {
  const perMinute = m.timings.transcribeSeconds / Math.max(m.transcript.duration / 60, 1 / 60)
  return `${duration(m.transcript.duration)} · transcribed in ${m.timings.transcribeSeconds.toFixed(1)}s (${perMinute.toFixed(1)}s per audio minute)`
}

export function MeetingView({
  meeting,
  focus,
  onRenamed,
}: {
  meeting: Meeting
  focus: number | undefined
  onRenamed: () => void
}) {
  const [active, setActive] = useState<number>()
  const [title, setTitle] = useState(meeting.title)
  useEffect(() => setTitle(meeting.title), [meeting.title])

  const jump = useCallback((segmentId: number) => {
    setActive(segmentId)
    document
      .getElementById(`seg-${segmentId}`)
      ?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }, [])

  useEffect(() => {
    if (focus === undefined) return
    const seg = meeting.transcript.segments.find((s) => Math.abs(s.start - focus) < 0.01)
    if (seg) setTimeout(() => jump(seg.id), 50)
  }, [focus, meeting, jump])

  const save = () => {
    if (title.trim() && title !== meeting.title)
      void api.renameMeeting(meeting.id, title).then(onRenamed)
  }

  return (
    <div className="meeting">
      <header className="meeting-head">
        <input
          className="title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={save}
          onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
          spellCheck={false}
          aria-label="Meeting title"
        />
        <div className="meta">
          <span>
            {day(meeting.date)} · {time(meeting.date)} · {stats(meeting)}
          </span>
          <button
            type="button"
            className="ghost"
            onClick={() => void api.revealMeeting(meeting.id)}
          >
            Show Markdown
          </button>
        </div>
      </header>
      <div className="columns">
        <section className="minutes">
          {meeting.minutes ? (
            <Minutes minutes={meeting.minutes} jump={jump} />
          ) : (
            <p className="muted">
              Transcript only. Start Ollama to get minutes for the next meeting.
            </p>
          )}
        </section>
        <section className="transcript">
          <h3>Transcript</h3>
          {meeting.transcript.segments.map((s) => (
            <p key={s.id} id={`seg-${s.id}`} className={`seg ${active === s.id ? 'active' : ''}`}>
              <span className="seg-time">{timestamp(s.start)}</span>
              <span className={`seg-who ${s.speaker === 'Me' ? 'me' : ''}`}>{s.speaker}</span>
              <span className="seg-text">{s.text}</span>
            </p>
          ))}
        </section>
      </div>
    </div>
  )
}
