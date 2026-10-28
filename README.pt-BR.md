<p align="center">
  <img src="docs/icon.png" width="88" alt="" />
</p>

<h1 align="center">Tacet</h1>

<p align="center">
  Atas de reunião que nunca saem do seu computador.<br/>
  Grava o seu microfone e o áudio da call, transcreve com o whisper.cpp e escreve a ata com um LLM local.
</p>

<p align="center">
  <a href="README.md">English</a> · Português
</p>

<p align="center">
  <img src="docs/demo-pt.gif" width="860" alt="O Tacet gravando uma call de planejamento de um minuto, depois a ata com decisões e tarefas com dono e prazo, e um clique numa tarefa que leva à fala na transcrição" />
  <br/>
  <sub>Call inventada de um minuto, com vozes sintéticas, gravada num MacBook Pro M4. A call roda em 1,5× e a espera pelo whisper.cpp e pelo LLM local (uns 50 s) virou 6 s. Com som: <a href="docs/demo-pt.mp4">docs/demo-pt.mp4</a>.</sub>
</p>

## Instalação

```bash
# App de bandeja: baixe o .dmg, .exe ou .AppImage em Releases
open https://github.com/OwlHugo/tacet/releases/latest

# CLI, sem instalar
npx tacet transcribe reuniao.wav
```

Precisa do [whisper.cpp](https://github.com/ggml-org/whisper.cpp) (`brew install whisper-cpp` no macOS; os builds de Windows e Linux já trazem) e, para a ata, do [Ollama](https://ollama.com) com um modelo (`ollama pull qwen2.5:7b`). `npx tacet doctor` confere tudo.

## Seus dados ficam na sua máquina

**Nada sai do seu computador.** Sem conta, sem servidor, sem telemetria.

- O áudio é gravado numa pasta local e transcrito por um processo do whisper.cpp.
- A ata é escrita pelo Ollama em `localhost`. O core recusa qualquer host do Ollama que não seja loopback, então um `OLLAMA_HOST` errado não manda a transcrição para outra máquina.
- A única requisição de rede é o download, uma vez, dos pesos públicos do modelo no Hugging Face.
- As notas são arquivos Markdown numa pasta que você escolhe.

## O que faz

- **Duas faixas, sem driver.** Microfone e áudio do sistema gravados em arquivos separados, então "Eu" e "Outros" vêm de graça. O eco do microfone é removido quando você não usa fone.
- **Ata ancorada.** Resumo, decisões e tarefas com dono e prazo. Cada item cita as linhas da transcrição; o que não está na transcrição sai da ata, e os horários vêm da transcrição, nunca do modelo.
- **Uma chamada por parte.** Resumo, decisões e tarefas são pedidos separados ao modelo; cada decisão é confirmada nas próprias falas (pergunta, piada ou reclamação não vira decisão) e cada prazo é conferido contra a tarefa dele.
- **Arquivo de uma faixa só.** Importe um `.wav`, `.m4a` ou `.mp3`. Na CLI, com `--me Seu Nome` (e `--alias Apelido`), o que for pedido a você sai com você de dono, e com `--vocab palavras.txt` o whisper escreve certo os nomes e termos que você lista. No app essas opções ainda não existem.
- **Markdown pronto para o Obsidian**, busca em todas as reuniões, atalho global `⌘⇧M` / `Ctrl+Shift+M`.

## CLI

```
tacet transcribe <audio...>        um arquivo, ou --mic eu.wav --system eles.wav
  -m, --model tiny|base|small|large-v3-turbo|caminho.bin
  -l, --language pt|en|...|auto
  --llm qwen2.5:7b   --no-minutes   -t "Título"   -o ~/notas   --json
  --vocab palavras.txt   nomes e termos que o whisper deve esperar, um por linha
  --me Ana --alias Aninha   quem é você: tarefas pedidas a você saem com você de dono
tacet search "tela de pedido" [--dir ~/notas]
tacet list [--dir ~/notas]
tacet doctor
```

## Desenvolvimento

```bash
pnpm install && pnpm check      # o que o CI roda
./scripts/verificar.sh          # os mesmos gates mais o build
pnpm tacet transcribe x.wav     # a CLI direto do código
pnpm desktop                    # Electron em modo dev
```

Node 24.12+ e pnpm 10. Regras para quem contribui: [AGENTS.md](AGENTS.md) e [CONTRIBUTING.md](CONTRIBUTING.md). O resto da documentação (eval, arquitetura, permissões, problemas conhecidos) está no [README em inglês](README.md).

## Licença

MIT
