// 전체·명령별 도움말 순수 함수 (specs/features/F-2132.md 5장)
import brand from '../../brand.config'
import { COMMAND_NAMES, type CommandName } from './args'

const CLI = brand.cliName
const ENV_PREFIX = CLI.toUpperCase()

const COMMAND_DESCRIPTIONS: Record<CommandName, string> = {
  login: '브라우저로 로그인해 토큰을 저장합니다',
  logout: '이 컴퓨터에 저장한 토큰을 지웁니다',
  whoami: '로그인한 계정을 보여 줍니다',
  ls: '내 문서 목록 (--path: 폴더 경로 열, --root: 맨 위 문서만, --shared: 공유받은 문서)',
  find: '제목에 그 글자가 든 내 문서를 찾습니다 (대소문자 무시)',
  search: '제목·본문에 그 글자가 든 내 문서와 줄을 찾습니다 (금고 문서 제외)',
  info: '문서 정보(폴더 경로·판 번호·시각)를 내용 없이 보여 줍니다',
  get: '문서 원문을 출력합니다',
  new: '새 문서를 만듭니다',
  put: '문서를 고칩니다 (get 으로 받은 판 번호 --base-version 필요, --dry-run 은 미리 보기. 자세히: put --help)',
  mv: '문서를 다른 폴더로 옮깁니다',
  rm: '문서를 영구 삭제합니다 (--yes 필요)',
  folders: '폴더 목록',
  mkdir: '폴더를 만듭니다',
  rmdir: '폴더를 지웁니다. 안의 것은 위 폴더로 (--all: 모두 영구 삭제, --yes 필요)',
  upload: '이미지를 올리고 붙일 마크다운을 출력합니다',
  link: '읽기 전용 링크를 만듭니다',
  syntax: '문서에 쓰는 마크다운 문법(콜아웃·위키링크·수식 등)을 출력합니다',
}

export function helpText(version: string): string {
  const lines = [`${brand.name} 명령줄 도구 ${version}`, '']
  for (const name of COMMAND_NAMES) lines.push(`  ${name}\t${COMMAND_DESCRIPTIONS[name]}`)
  lines.push('')
  lines.push(`명령별 옵션은 ${CLI} help <명령> 또는 ${CLI} <명령> --help 로 봅니다.`)
  lines.push('Windows PowerShell 5.1 에서는 > 대신 -o 로 저장하세요. > 는 파일을 UTF-16 으로 바꿉니다.')
  lines.push(`AI 도구에서 쓸 때는 npx -y ${CLI} … 또는 ${ENV_PREFIX}_TOKEN 환경 변수를 쓰세요.`)
  lines.push(`AI 도구가 문서를 쓰기 전에 ${CLI} syntax 로 콜아웃·위키링크 같은 문법을 확인하게 하세요.`)
  return lines.join('\n') + '\n'
}

// 옵션 줄 — 설명 시작 열은 블록 안에서만 맞춘다
function optionLines(rows: Array<[string, string]>): string[] {
  const width = Math.max(...rows.map(([flag]) => flag.length)) + 2
  return rows.map(([flag, text]) => `  ${flag.padEnd(width)}${text}`)
}

const PATH_GUIDE = `폴더 경로는 ${CLI} folders 가 보여 주는 모양(예: 수업자료/1주차)입니다.`

// 한 줄 설명만으로 모자란 명령의 덧붙임 — put 은 판 번호만 맞춰 올리다 그 사이 저장분을 덮어쓰기 쉽다
const COMMAND_DETAILS: Partial<Record<CommandName, string[]>> = {
  login: [
    '',
    `사용: ${CLI} login [--force] [--with-token] [--no-browser]`,
    ...optionLines([
      ['--force', '이미 로그인돼 있어도 다시 로그인합니다'],
      ['--with-token', `브라우저 대신 표준 입력의 API 토큰을 저장합니다 (${CLI} login --with-token < token.txt)`],
      ['--no-browser', '브라우저를 열지 않고 승인 주소만 표준 오류에 찍습니다'],
    ]),
  ],
  ls: [
    '',
    `사용: ${CLI} ls [--folder <폴더id|경로> | --root | --shared] [--path]`,
    '  --folder <폴더id|경로>  그 폴더에 바로 든 문서만 (하위 폴더의 문서는 빠집니다)',
    '  --root             폴더에 들지 않은 맨 위 문서만',
    '  --path             제목 앞에 폴더 경로 열을 넣습니다. 맨 위 문서는 /',
    '  --shared           공유받은 문서',
    PATH_GUIDE,
    '시각은 UTC(ISO 8601)입니다. --json 의 시각 필드는 1970년부터의 밀리초입니다.',
  ],
  find: [
    '',
    `사용: ${CLI} find <제목> [--folder <폴더id|경로> | --root] [--path]`,
    ...optionLines([
      ['--folder <폴더id|경로>', '그 폴더에 바로 든 문서 중에서만'],
      ['--root', '폴더에 들지 않은 맨 위 문서 중에서만'],
      ['--path', '제목 앞에 폴더 경로 열을 넣습니다. 맨 위 문서는 /'],
    ]),
    `띄어쓰기가 든 제목은 따옴표로 감싸세요. ${PATH_GUIDE}`,
  ],
  search: [
    '',
    `사용: ${CLI} search <검색어> [--folder <폴더id|경로>]`,
    ...optionLines([['--folder <폴더id|경로>', '그 폴더와 하위 폴더의 문서 중에서만']]),
    '정규식이 아니라 글자 그대로 찾고, 영문 대소문자는 무시합니다.',
    '문서마다 맞는 줄을 5개까지 보여 줍니다. 문서는 최근에 고친 것부터 200개까지입니다.',
    '금고 문서는 서버가 내용을 읽을 수 없어 찾지 못하고, 그 수만 끝 줄에 알려 줍니다.',
    `띄어쓰기가 든 검색어는 따옴표로 감싸세요. ${PATH_GUIDE}`,
  ],
  get: [
    '',
    `사용: ${CLI} get <id> [-o <파일>]`,
    ...optionLines([['-o, --output <파일>', '원문을 그 파일에 UTF-8 로 씁니다. 표준 출력에는 id 와 판 번호만']]),
  ],
  new: [
    '',
    `사용: ${CLI} new [<파일>|-] [--title <제목>] [--folder <폴더id|경로>] [--url]`,
    ...optionLines([
      ['<파일>|-', '올릴 원문. - 는 표준 입력. 없으면 빈 문서이고 --title 이 필요합니다'],
      ['--title <제목>', '없으면 파일 이름에서 .md 를 뗀 것'],
      ['--folder <폴더id|경로>', '넣을 폴더. 없으면 맨 위'],
      ['--url', 'id 다음 줄에 앱에서 여는 주소를 찍습니다. --json 이면 url 필드'],
    ]),
    PATH_GUIDE,
  ],
  put: [
    '',
    `사용: ${CLI} put <id> [<파일>|-] [--title <제목>] (--base-version <n> | --force) [--dry-run]`,
    ...optionLines([
      ['--title <제목>', '제목을 바꿉니다'],
      ['--base-version <n>', 'get 으로 받았을 때의 판 번호. 그 사이 서버 문서가 바뀌었으면 덮어쓰지 않고 종료 코드 5 로 멈춥니다'],
      ['--force', '서버의 지금 판 위에 확인 없이 덮어씁니다. 그 사이 다른 곳에서 고친 내용이 사라집니다'],
      ['--dry-run', '서버에 쓰지 않고 바뀌는 줄 수·줄바꿈 방식을 보여 줍니다. --base-version·--force 를 빼도 됩니다'],
    ]),
    '',
    `순서: ${CLI} get <id> -o 파일.md 로 내용과 판 번호를 한 번에 받아 그 파일을 고친 뒤 put 하세요.`,
    '판 번호만 다시 읽고 옛 내용을 올리면 번호는 맞아도 그 사이 저장분을 덮어씁니다.',
    '파일의 줄바꿈(LF·CRLF)이 서버 문서와 다르면 서버 문서 방식으로 맞춰 저장됩니다.',
    '제목을 바꾸면 옛 제목으로 건 [[위키링크]] 는 자동으로 고쳐지지 않아 끊깁니다.',
  ],
  mv: [
    '',
    `사용: ${CLI} mv <id> (--folder <폴더id|경로> | --root)`,
    ...optionLines([
      ['--folder <폴더id|경로>', '옮길 폴더'],
      ['--root', '폴더 밖 맨 위로'],
    ]),
    PATH_GUIDE,
    '[[폴더/문서 제목]] 처럼 폴더를 붙여 건 위키링크는 옮기면 끊길 수 있습니다.',
  ],
  rm: [
    '',
    `사용: ${CLI} rm <id> --yes`,
    ...optionLines([['--yes', '묻지 않고 영구 삭제합니다. 되돌릴 수 없습니다']]),
  ],
  mkdir: [
    '',
    `사용: ${CLI} mkdir <이름> [--parent <폴더id|경로>]`,
    ...optionLines([['--parent <폴더id|경로>', '그 폴더 안에 만듭니다. 없으면 맨 위']]),
    `${PATH_GUIDE} 같은 자리에 같은 이름의 폴더가 있어도 새로 만듭니다.`,
  ],
  rmdir: [
    '',
    `사용: ${CLI} rmdir <폴더id> --yes [--all]`,
    ...optionLines([
      ['--yes', '묻지 않고 지웁니다. 안의 문서와 폴더는 위 폴더로 옮겨집니다'],
      ['--all', '안의 문서와 폴더까지 모두 영구 삭제합니다. 되돌릴 수 없습니다'],
    ]),
    `폴더는 경로가 아니라 id 로만 지정합니다. ${CLI} folders 로 확인하세요.`,
  ],
}

export function commandHelpText(command: CommandName): string {
  const lines = [`${CLI} ${command} — ${COMMAND_DESCRIPTIONS[command]}`, ...(COMMAND_DETAILS[command] ?? [])]
  return lines.join('\n') + '\n'
}
