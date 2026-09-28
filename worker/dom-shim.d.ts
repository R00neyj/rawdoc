// worker/tsconfig.json 는 DOM lib 없이(ES2022) ../src/types.ts 를 함께 타입체크한다
// FileSystemFileHandle(F-231, File System Access API)은 워커가 쓰지 않고 타입 이름만 필요해 DOM lib 대신 이름만 선언한다
// eslint-disable-next-line @typescript-eslint/no-empty-object-type -- 이름만 필요, 형태는 쓰지 않음
interface FileSystemFileHandle {}
