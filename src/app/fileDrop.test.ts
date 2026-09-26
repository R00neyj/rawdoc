import { describe, it, expect } from 'vitest'
import { isExternalFileDrag, pickMarkdownFiles, pickImageFiles, isImageOnlyDrag, classifyDroppedEntries, readDroppedDirectory } from './fileDrop'

function file(name: string): File {
  return { name } as unknown as File
}

function dataTransfer(input: Partial<DataTransfer>): DataTransfer {
  return input as unknown as DataTransfer
}

function dragItem(input: { kind: string; type: string }): DataTransferItem {
  return input as unknown as DataTransferItem
}

describe('isExternalFileDrag', () => {
  it('types 에 Files 가 있으면 true', () => {
    expect(isExternalFileDrag(dataTransfer({ types: ['Files'] }))).toBe(true)
  })

  it('types 에 Files 가 없으면 false (사이드바 문서·폴더 끌기는 text/plain 만 쓴다)', () => {
    expect(isExternalFileDrag(dataTransfer({ types: ['text/plain'] }))).toBe(false)
  })

  it('dataTransfer 가 없으면 false', () => {
    expect(isExternalFileDrag(null)).toBe(false)
    expect(isExternalFileDrag(undefined)).toBe(false)
  })

  it('types 가 없으면 false', () => {
    expect(isExternalFileDrag(dataTransfer({}))).toBe(false)
  })
})

describe('pickMarkdownFiles', () => {
  it('.md 확장자만 골라낸다', () => {
    const result = pickMarkdownFiles([file('a.md')])
    expect(result.mdFiles.map((f) => f.name)).toEqual(['a.md'])
    expect(result.allNonMd).toBe(false)
  })

  it('.MD 대문자도 골라낸다', () => {
    const result = pickMarkdownFiles([file('A.MD')])
    expect(result.mdFiles.map((f) => f.name)).toEqual(['A.MD'])
    expect(result.allNonMd).toBe(false)
  })

  it('섞인 목록은 .md 만 남기고 allNonMd 는 false', () => {
    const result = pickMarkdownFiles([file('a.md'), file('b.md'), file('c.txt')])
    expect(result.mdFiles.map((f) => f.name)).toEqual(['a.md', 'b.md'])
    expect(result.allNonMd).toBe(false)
  })

  it('전부 비 .md 면 allNonMd 는 true, mdFiles 는 빈 배열', () => {
    const result = pickMarkdownFiles([file('c.txt'), file('d.png')])
    expect(result.mdFiles).toEqual([])
    expect(result.allNonMd).toBe(true)
  })

  it('빈 목록이면 allNonMd 는 false', () => {
    const result = pickMarkdownFiles([])
    expect(result.mdFiles).toEqual([])
    expect(result.allNonMd).toBe(false)
  })

  it('null·undefined 는 빈 목록으로 처리', () => {
    expect(pickMarkdownFiles(null).mdFiles).toEqual([])
    expect(pickMarkdownFiles(undefined).mdFiles).toEqual([])
  })
})

describe('pickImageFiles (F-156.md 2.5)', () => {
  it('png·jpg·jpeg·gif·webp 확장자를 고른다', () => {
    const names = ['a.png', 'b.jpg', 'c.jpeg', 'd.gif', 'e.webp', 'f.txt', 'g.md']
    const result = pickImageFiles(names.map(file))
    expect(result.imageFiles.map((f) => f.name)).toEqual(['a.png', 'b.jpg', 'c.jpeg', 'd.gif', 'e.webp'])
  })

  it('대문자 확장자도 고른다', () => {
    expect(pickImageFiles([file('A.PNG')]).imageFiles.map((f) => f.name)).toEqual(['A.PNG'])
  })

  it('null·undefined 는 빈 목록', () => {
    expect(pickImageFiles(null).imageFiles).toEqual([])
    expect(pickImageFiles(undefined).imageFiles).toEqual([])
  })
})

describe('isImageOnlyDrag (F-156.md 2.5)', () => {
  it('items 가 전부 kind=file, type=image/* 면 true', () => {
    expect(
      isImageOnlyDrag(
        dataTransfer({ items: [dragItem({ kind: 'file', type: 'image/png' }), dragItem({ kind: 'file', type: 'image/jpeg' })] as unknown as DataTransferItemList }),
      ),
    ).toBe(true)
  })

  it('하나라도 이미지가 아니면 false', () => {
    expect(
      isImageOnlyDrag(
        dataTransfer({ items: [dragItem({ kind: 'file', type: 'image/png' }), dragItem({ kind: 'file', type: 'text/markdown' })] as unknown as DataTransferItemList }),
      ),
    ).toBe(false)
  })

  it('items 가 없거나 비어 있으면 false', () => {
    expect(isImageOnlyDrag(dataTransfer({ items: [] as unknown as DataTransferItemList }))).toBe(false)
    expect(isImageOnlyDrag(dataTransfer({}))).toBe(false)
    expect(isImageOnlyDrag(null)).toBe(false)
  })
})

// ---------- F-2019.md 4.3 U15 ----------
function fakeFile(name: string): File {
  return { name } as unknown as File
}

function dirEntry(name: string, fullPath: string, reader: FileSystemDirectoryReader): FileSystemDirectoryEntry {
  return {
    isFile: false,
    isDirectory: true,
    name,
    fullPath,
    createReader: () => reader,
  } as unknown as FileSystemDirectoryEntry
}

function fileEntry(name: string, fullPath: string, file: File): FileSystemFileEntry {
  return {
    isFile: true,
    isDirectory: false,
    name,
    fullPath,
    file: (success: (f: File) => void) => success(file),
  } as unknown as FileSystemFileEntry
}

function batchedReader(entries: FileSystemEntry[], batchSizes: number[]): FileSystemDirectoryReader {
  let idx = 0
  let call = 0
  return {
    readEntries(success: (entries: FileSystemEntry[]) => void) {
      const size = batchSizes[call] ?? 0
      const batch = entries.slice(idx, idx + size)
      idx += size
      call++
      Promise.resolve().then(() => success(batch))
    },
  } as unknown as FileSystemDirectoryReader
}

function errorReader(): FileSystemDirectoryReader {
  return {
    readEntries(_success: unknown, error: (err: unknown) => void) {
      Promise.resolve().then(() => error(new Error('읽기 실패')))
    },
  } as unknown as FileSystemDirectoryReader
}

describe('classifyDroppedEntries (F-2019.md 4.3 U15)', () => {
  it('빈 목록·null·파일만 → none', () => {
    expect(classifyDroppedEntries([])).toEqual({ kind: 'none' })
    expect(classifyDroppedEntries([null])).toEqual({ kind: 'none' })
    expect(classifyDroppedEntries([fileEntry('a.md', '/a.md', fakeFile('a.md'))])).toEqual({ kind: 'none' })
  })

  it('디렉터리 하나 → folder', () => {
    const dir = dirEntry('내 볼트', '/내 볼트', batchedReader([], [0]))
    const result = classifyDroppedEntries([dir])
    expect(result).toEqual({ kind: 'folder', entry: dir })
  })

  it('디렉터리 둘 → too-many', () => {
    const a = dirEntry('a', '/a', batchedReader([], [0]))
    const b = dirEntry('b', '/b', batchedReader([], [0]))
    expect(classifyDroppedEntries([a, b])).toEqual({ kind: 'too-many' })
  })

  it('디렉터리 + 파일 → too-many', () => {
    const dir = dirEntry('a', '/a', batchedReader([], [0]))
    expect(classifyDroppedEntries([dir, fileEntry('x.md', '/x.md', fakeFile('x.md'))])).toEqual({ kind: 'too-many' })
  })

  it('디렉터리 + null → too-many (null 은 파일)', () => {
    const dir = dirEntry('a', '/a', batchedReader([], [0]))
    expect(classifyDroppedEntries([dir, null])).toEqual({ kind: 'too-many' })
  })
})

describe('readDroppedDirectory (F-2019.md 4.3 U15)', () => {
  it('readEntries 가 100·37·0 개로 나눠 줘도 137개, 경로가 루트/하위/a.md', () => {
    const files: FileSystemEntry[] = Array.from({ length: 137 }, (_, i) =>
      fileEntry(`f${i}.md`, `/내 볼트/하위/f${i}.md`, fakeFile(`f${i}.md`)),
    )
    const root = dirEntry('내 볼트', '/내 볼트', batchedReader(files, [100, 37, 0]))
    return readDroppedDirectory(root).then((result) => {
      expect(result).toHaveLength(137)
      expect(result[0].path).toBe('내 볼트/하위/f0.md')
    })
  })

  it('하위 디렉터리를 재귀로 읽는다', () => {
    const innerFile = fileEntry('b.md', '/루트/하위/b.md', fakeFile('b.md'))
    const inner = dirEntry('하위', '/루트/하위', batchedReader([innerFile], [1, 0]))
    const topFile = fileEntry('a.md', '/루트/a.md', fakeFile('a.md'))
    const root = dirEntry('루트', '/루트', batchedReader([topFile, inner], [2, 0]))
    return readDroppedDirectory(root).then((result) => {
      const paths = result.map((r) => r.path).sort()
      expect(paths).toEqual(['루트/a.md', '루트/하위/b.md'])
    })
  })

  it('.git·__MACOSX 디렉터리의 createReader 를 부르지 않는다', () => {
    let calledInnerReader = false
    const innerFile = fileEntry('x', '/루트/.git/x', fakeFile('x'))
    const gitReader: FileSystemDirectoryReader = {
      readEntries(success: (entries: FileSystemEntry[]) => void) {
        calledInnerReader = true
        Promise.resolve().then(() => success([innerFile]))
      },
    } as unknown as FileSystemDirectoryReader
    const gitDir = dirEntry('.git', '/루트/.git', gitReader)
    const macDir = dirEntry('__MACOSX', '/루트/__MACOSX', gitReader)
    const root = dirEntry('루트', '/루트', batchedReader([gitDir, macDir], [2, 0]))
    return readDroppedDirectory(root).then((result) => {
      expect(result).toHaveLength(0)
      expect(calledInnerReader).toBe(false)
    })
  })

  it('오류 콜백이면 거부한다', async () => {
    const root = dirEntry('루트', '/루트', errorReader())
    await expect(readDroppedDirectory(root)).rejects.toThrow()
  })
})
