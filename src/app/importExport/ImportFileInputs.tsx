import type { RefObject } from 'react'
import type { UseImportFlowResult } from './useImportFlow'

export type ImportFileInputsProps = Pick<UseImportFlowResult, 'handleImportFolderInputChange' | 'handleImportInputChange' | 'handleImportZipInputChange'> & {
  importFolderInputRef: RefObject<HTMLInputElement | null>
  importInputRef: RefObject<HTMLInputElement | null>
  importZipInputRef: RefObject<HTMLInputElement | null>
}

export default function ImportFileInputs({
  handleImportFolderInputChange, handleImportInputChange, handleImportZipInputChange, importFolderInputRef, importInputRef, importZipInputRef,
}: ImportFileInputsProps) {
  return (
    <>
      <input
        ref={importInputRef}
        type="file"
        accept=".md,text/markdown"
        data-import="md"
        hidden
        onChange={handleImportInputChange}
      />
      <input
        ref={importZipInputRef}
        type="file"
        accept=".zip,application/zip"
        data-import="zip"
        hidden
        onChange={handleImportZipInputChange}
      />
      <input
        ref={(el) => {
          importFolderInputRef.current = el
          // webkitdirectory 는 React 19 JSX 타입에 없다 — ref 콜백에서 켠다 (F-2019.md 4.2)
          if (el) el.webkitdirectory = true
        }}
        type="file"
        data-import="folder"
        hidden
        onChange={handleImportFolderInputChange}
      />
    </>
  )
}
