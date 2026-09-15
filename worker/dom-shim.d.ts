// worker/tsconfig.json 는 DOM lib 없이(ES2022) ../src/types.ts 를 함께 타입체크한다.
// FileSystemFileHandle(F-231, 브라우저 File System Access API)은 워커 코드가 쓰지 않고
// 타입 이름만 필요하므로, DOM lib 전체 대신 이름만 선언해 해석 가능하게 한다.
// eslint-disable-next-line @typescript-eslint/no-empty-object-type -- 이름만 필요, 형태는 쓰지 않음
interface FileSystemFileHandle {}
