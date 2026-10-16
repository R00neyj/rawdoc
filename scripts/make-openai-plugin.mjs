#!/usr/bin/env node
// OpenAI 플러그인 디렉터리 제출용 ZIP → dist-openai-plugin.zip (F-4008 5장). 이름·색은 brand.config.ts 에서 읽는다
// 시험 계정 표본(Work·Archive 폴더, Project plan·Release checklist 문서)이 review.test_cases 의 전제다
import { copyFileSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import brand from '../brand.config.ts'

const root = fileURLToPath(new URL('..', import.meta.url))
const out = `${root}dist-openai-plugin`
const zip = `${out}.zip`
const origin = process.env.PLUGIN_ORIGIN ?? `https://${brand.cliName}.app`
const version = process.argv[2] ?? '1.0.0'
const name = brand.name

const plugin = {
  $schema: 'https://agent-plugins.org/schemas/1.0.0/plugin.schema.json',
  name: brand.cliName,
  version,
  description: `Search, read, write and organize your ${name} Markdown documents from ChatGPT.`,
  author: { name, email: `contact@${new URL(origin).host}`, url: origin },
  homepage: `${origin}/guides/ai-connectors`,
  keywords: ['markdown', 'notes', 'documents', 'productivity'],
  extensions: {
    'com.openai': {
      interface: {
        displayName: name,
        shortDescription: 'Markdown notes, kept exact',
        longDescription: [
          `${name} is a source-preserving Markdown editor: the marks you type stay visible, and exporting gives back exactly the bytes you wrote. This app lets ChatGPT work with the documents in your ${name} account.`,
          '',
          'What it can do',
          '- Search your documents by title or text, and read any document in full as Markdown',
          '- List your documents, folders, and documents other people shared with you',
          '- Create documents and folders, rewrite or rename a document, and move documents between folders',
          `- Move documents or folders to the trash (restorable in ${name} for 30 days)`,
          '',
          'Safe editing',
          '- Updates are version-checked: if a document changed since it was read, nothing is overwritten and the latest text is returned so the edit can be reapplied.',
          '- Deletions only go to the trash, labeled with the app that deleted them.',
          '- Vault (end-to-end encrypted) documents are never readable through this connection.',
          '',
          `Requires a ${name} account (sign in with Google or GitHub). Writes share the same rate limit as the ${name} app and CLI. Connected apps can be disconnected anytime in ${name} Settings.`,
        ].join('\n'),
        developerName: name,
        category: 'Productivity',
        capabilities: ['Search documents', 'Read documents', 'Create and edit documents', 'Organize folders', 'Move to trash'],
        websiteURL: origin,
        supportURL: `${origin}/help`,
        privacyPolicyURL: `${origin}/privacy`,
        termsOfServiceURL: `${origin}/terms`,
        defaultPrompt: [
          `Find my ${name} notes about the release checklist.`,
          `Save a summary of this chat as a new ${name} document.`,
          `What folders do I have in ${name}?`,
        ],
        brandColor: brand.accent,
        composerIcon: './assets/icon.png',
        logo: './assets/icon.png',
      },
      review: {
        test_cases: {
          positive: [
            {
              description: 'Find a document by text and read it',
              prompt: `Find my ${name} note about the release checklist and tell me which items are still unchecked.`,
              tools_triggered: 'search, fetch',
              expected_behavior: 'Finds "Release checklist", reads its full Markdown, and lists only the unchecked "- [ ]" items from that document.',
            },
            {
              description: 'Browse folders and their documents',
              prompt: `What folders do I have in ${name}, and which documents are in the Work folder?`,
              tools_triggered: 'list_folders, list_documents',
              expected_behavior: 'Lists the folders (including Work and Archive) and the documents directly inside Work, such as "Project plan" and "Release checklist".',
            },
            {
              description: 'Create a document in a folder',
              prompt: `Create a ${name} document called "Weekly summary" in my Work folder with three bullet points about planning, testing and release.`,
              tools_triggered: 'list_folders, create_document',
              expected_behavior: 'Creates "Weekly summary" inside Work with three Markdown bullet points and returns a link to open it.',
            },
            {
              description: 'Edit an existing document with a version check',
              prompt: `In my ${name} document "Project plan", change the deadline line to "Deadline: 2026-12-01".`,
              tools_triggered: 'search, fetch, update_document',
              expected_behavior: 'Reads "Project plan", passes its version as baseVersion, and updates only the deadline line; the rest of the Markdown is unchanged.',
            },
            {
              description: 'Move a document, then move it to the trash',
              prompt: `Move my ${name} document "Weekly summary" to the Archive folder, then move it to the trash.`,
              tools_triggered: 'list_folders, move_document, delete_document',
              expected_behavior: `Moves "Weekly summary" into Archive, then moves it to the trash after confirming with the user. It can be restored from the trash in ${name} for 30 days.`,
            },
          ],
          // 포털 정의: 플러그인이 호출되면 안 되지만 모델이 관련 있다고 착각할 만한 프롬프트
          negative: [
            {
              description: 'General Markdown help needs no stored documents',
              prompt: 'How do I make a table in Markdown? Show me an example.',
            },
            {
              description: 'Text the user pasted into the chat is already available',
              prompt: 'Summarize this note I pasted: "Kickoff moved to Monday. Budget approved. Design review on Friday."',
            },
            {
              description: 'Notes in another service are not in this account',
              prompt: 'Find my meeting notes in Google Docs from last week.',
            },
          ],
        },
        commerce: false,
        commerce_description: 'This app does not sell products or process payments.',
      },
      publication: {
        release_notes: `Initial release: search, read, create, edit, move and trash ${name} documents and folders.`,
      },
    },
  },
}

const mcp = {
  $schema: 'https://agent-plugins.org/schemas/1.0.0/mcp.schema.json',
  mcpServers: {
    [brand.cliName]: {
      type: 'streamable-http',
      url: `${origin}/mcp`,
      extensions: { 'com.openai': { auth: { type: 'oauth', client: { mode: 'dcr' } } } },
    },
  },
}

rmSync(out, { recursive: true, force: true })
rmSync(zip, { force: true })
mkdirSync(`${out}/assets`, { recursive: true })
writeFileSync(`${out}/plugin.json`, `${JSON.stringify(plugin, null, 2)}\n`)
writeFileSync(`${out}/mcp.json`, `${JSON.stringify(mcp, null, 2)}\n`)
copyFileSync(`${root}public/icons/icon-512.png`, `${out}/assets/icon.png`)

// Windows 10+ 의 tar(bsdtar)와 macOS·Linux bsdtar 모두 -a 로 확장자를 보고 zip 을 만든다
const res = spawnSync('tar', ['-a', '-cf', zip, 'plugin.json', 'mcp.json', 'assets'], { cwd: out, stdio: 'inherit' })
if (res.status !== 0) process.exit(res.status ?? 1)
console.log(zip)
