import * as utils from './utils.js'
import { setTrimValue } from './trimming.js'
import { sendLog } from './connection.js'
import type { PDFViewerApplicationType, PDFViewerApplicationOptionsType } from './interface'
import type { PdfViewerParams } from '../../types/latex-workshop-protocol-types/index.js'

declare const pdfjsLib: any
declare const PDFViewerApplication: PDFViewerApplicationType
declare const PDFViewerApplicationOptions: PDFViewerApplicationOptionsType

let autoReloadEnabled = true
export function IsAutoReloadEnabled() {
    return autoReloadEnabled
}
export function toggleAutoReload() {
    autoReloadEnabled = !autoReloadEnabled
    return autoReloadEnabled
}

let prevState: {
    page: number,
    scrollMode: number,
    sidebarView: number,
    spreadMode: number,
    scrollTop: number,
    scrollLeft: number
} | undefined

export async function refresh() {
    if (!IsAutoReloadEnabled()) {
        sendLog('Auto reload temporarily disabled.')
        return
    }

    // Fail-safe. For unknown reasons, the pack may have null values #4076
    const currentState = {
        page: PDFViewerApplication.pdfViewer.currentPageNumber ?? prevState?.page,
        scrollMode: PDFViewerApplication.pdfViewer.scrollMode ?? prevState?.scrollMode,
        sidebarView: PDFViewerApplication.pdfSidebar.visibleView ?? prevState?.sidebarView,
        spreadMode: PDFViewerApplication.pdfViewer.spreadMode ?? prevState?.spreadMode,
        scrollTop: (document.getElementById('viewerContainer') as HTMLElement).scrollTop ?? prevState?.scrollTop,
        scrollLeft: (document.getElementById('viewerContainer') as HTMLElement).scrollLeft ?? prevState?.scrollLeft
    }
    prevState = currentState

    // Note: without showPreviousViewOnLoad = false restoring the position after the refresh will fail if
    // the user has clicked on any link in the past (pdf.js will automatically navigate to that link).
    PDFViewerApplicationOptions.set('showPreviousViewOnLoad', false)

    // Override the spread mode specified in PDF documents with the current one.
    // https://github.com/James-Yu/LaTeX-Workshop/issues/1871
    if (typeof prevState.spreadMode === 'number') {
        PDFViewerApplicationOptions.set('spreadModeOnLoad', prevState.spreadMode)
    }

    const { encodedPath, docTitle } = utils.parseURL()
    /* eslint-disable */
    const doc = await pdfjsLib.getDocument({
        url: `/${utils.pdfFilePrefix}${encodedPath}`,
        cMapUrl: '../cmaps/'
    }).promise
    PDFViewerApplication.load(doc)
    /* eslint-enable */
    // reset the document title to the original value to avoid duplication
    document.title = docTitle
}

export async function restoreState() {
    if (prevState === undefined) {
        await restoreDefault()
        return
    }

    if (prevState.page !== undefined) {
        PDFViewerApplication.pdfViewer.currentPageNumber = prevState.page
    }
    if (prevState.sidebarView) {
        PDFViewerApplication.pdfSidebar.switchView(prevState.sidebarView)
    }
    if (typeof prevState.scrollMode === 'number' && PDFViewerApplication.pdfViewer.scrollMode !== prevState.scrollMode) {
        PDFViewerApplication.pdfViewer.scrollMode = prevState.scrollMode
    }
    if (typeof prevState.spreadMode === 'number' && PDFViewerApplication.pdfViewer.spreadMode !== prevState.spreadMode) {
        PDFViewerApplication.pdfViewer.spreadMode = prevState.spreadMode
    }

    const viewerContainer = document.getElementById('viewerContainer')!
    if (typeof prevState.scrollTop === 'number' && viewerContainer.scrollTop !== prevState.scrollTop) {
        viewerContainer.scrollTop = prevState.scrollTop
    }
    if (typeof prevState.scrollLeft === 'number' && viewerContainer.scrollLeft !== prevState.scrollLeft) {
        viewerContainer.scrollLeft = prevState.scrollLeft
    }
}

async function restoreDefault() {
    const params = await (await fetch('config.json')).json() as PdfViewerParams

    if (params.trim !== undefined) {
        setTrimValue(params.trim)
    }
    // By setting the scale, scaling will be invoked if necessary.
    // The scale can be a non-number one.
    if (params.scale !== undefined) {
        PDFViewerApplication.pdfViewer.currentScaleValue = params.scale
    }
    if (params.scrollMode !== undefined) {
        PDFViewerApplication.pdfViewer.scrollMode = params.scrollMode
    }
    if (params.spreadMode !== undefined) {
        PDFViewerApplication.pdfViewer.spreadMode = params.spreadMode
    }
}

let oldVisiblePages: number[]
let oldScrollHeight: number
let oldPageCount: number
export function patchViewerRefresh() {
    /* eslint-disable */
    ;(globalThis as any).lwRecordRender = (pdfViewer: any) => {
        oldVisiblePages = pdfViewer._getVisiblePages().ids
        oldPageCount = pdfViewer.viewer.children.length
        let oldScale = pdfViewer.currentScale
        oldScrollHeight = pdfViewer.pdfDocument ? document.getElementById('viewerContainer')!.scrollHeight : 0
        return oldScale
    }
    ;(globalThis as any).lwRenderSync = async (pdfViewer: any, pdfDocument: any, pagesCount: number) => {
        await Array.from(oldVisiblePages)
            .filter(pageNum => pageNum <= pagesCount)
            .map(pageNum => pdfDocument.getPage(pageNum)
                .then((pdfPage: [number, any]) => [pageNum, pdfPage])
            )
            .reduce((accPromise, currPromise) => accPromise.then(() =>
                // This forces all visible pages to be rendered synchronously rather than asynchronously to avoid race condition involving this.renderingQueue.highestPriorityPage
                currPromise.then(([pageNum, pdfPage]: [number, any]) => {
                    const pageView = pdfViewer._pages[pageNum - 1]
                    if (!pageView.pdfPage) {
                        pageView.setPdfPage(pdfPage)
                    }
                    pdfViewer.renderingQueue.highestPriorityPage = pageView.renderingId
                    return pdfViewer._pages[pageNum - 1].draw().finally(() => {
                        pdfViewer.renderingQueue.renderHighestPriority()
                    })
                })), Promise.resolve()
            )
        document.getElementById('viewerContainer')!.scrollTop += oldScrollHeight
        for (let i = 1; i <= oldPageCount; i++) {
            pdfViewer.viewer.removeChild(pdfViewer.viewer.firstChild)
        }
    }
    /* eslint-enable */
}
