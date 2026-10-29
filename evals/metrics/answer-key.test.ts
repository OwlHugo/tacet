import type { Minutes } from '@tacet/core'
import { describe, expect, it } from 'vitest'
import { type AnswerKey, AnswerKeySchema, checkAnswerKey, holds } from './answer-key.ts'

const cite = { segments: [0] as [number], at: 0 }
const minutes = (over: Partial<Minutes> = {}): Minutes => ({
  summary: [{ text: 'A equipe discutiu a tela de pedidos do portal.', ...cite }],
  decisions: [],
  actionItems: [],
  rejected: [],
  model: 'm',
  ...over,
})
const decision = (text: string) => ({ text, quote: '', ...cite })
const task = (text: string, owner: string) => ({ task: text, owner, quote: '', ...cite })

const KEY: AnswerKey = {
  subject: ['pedido', 'portal'],
  decisions: [
    { keywords: ['relatorio'] },
    { keywords: ['bucket|nuvem'] },
    { keywords: ['formulario'], optional: true },
  ],
  tasks: [{ keywords: ['tela', 'pedido'], owner: ['Rafael'] }, { keywords: ['status'] }],
}

describe('holds', () => {
  it('needs every keyword, any alternative of each, ignoring accents, case and plurals', () => {
    expect(holds(['relatorio'], 'Sem Relatórios por enquanto')).toBe(true)
    expect(holds(['bucket|nuvem', 'nota'], 'a nota vai pra nuvem')).toBe(true)
    expect(holds(['bucket|nuvem', 'nota'], 'a nota vai pro disco')).toBe(false)
  })
})

describe('AnswerKeySchema', () => {
  it('refuses a keyword alternative that is only stopwords, since it could never match', () => {
    const key = (k: string) => ({ subject: ['portal'], decisions: [{ keywords: [k] }], tasks: [] })
    expect(AnswerKeySchema.safeParse(key('relatorio|sim')).success).toBe(false)
    expect(AnswerKeySchema.safeParse(key('ok')).success).toBe(false)
    expect(AnswerKeySchema.safeParse(key('relatorio|nuvem')).success).toBe(true)
  })
})

describe('checkAnswerKey', () => {
  it('scores precision, recall and the main subject against the key', () => {
    const r = checkAnswerKey(
      minutes({
        decisions: [decision('Sem relatório por enquanto.'), decision('Formulário simples.')],
        actionItems: [task('Entregar a tela de pedido', 'Rafael'), task('Mandar o status', 'Me')],
      }),
      KEY,
    )
    expect(r.subject).toBe(true)
    expect(r.decisions).toEqual({ given: 2, right: 2, found: 1, total: 2 })
    expect(r.tasks).toEqual({ given: 2, right: 2, found: 2, total: 2 })
    expect(r.wrongOwner).toBe(0)
    expect(r.invented).toEqual([])
  })

  it('counts a sarcastic remark taken as a decision, and a made-up task, as invented', () => {
    const r = checkAnswerKey(
      minutes({
        decisions: [decision('Alugar um helicóptero para jogar os panfletos.')],
        actionItems: [task('Pintar o prédio de azul', 'Others')],
      }),
      KEY,
    )
    expect(r.decisions).toEqual({ given: 1, right: 0, found: 0, total: 2 })
    expect(r.invented).toEqual([
      'decision: Alugar um helicóptero para jogar os panfletos.',
      'task: Pintar o prédio de azul',
    ])
  })

  it('flags a task given to the wrong person, and not one the key gives no owner', () => {
    const r = checkAnswerKey(
      minutes({
        actionItems: [task('Entregar a tela de pedido', 'Rafão'), task('Mandar o status', 'Ana')],
      }),
      KEY,
    )
    expect(r.wrongOwner).toBe(1)
    expect(r.tasks.right).toBe(2)
  })

  it('says when the summary lost the main subject', () => {
    const r = checkAnswerKey(
      minutes({ summary: [{ text: 'Reclamaram da diretoria.', ...cite }] }),
      KEY,
    )
    expect(r.subject).toBe(false)
  })
})
