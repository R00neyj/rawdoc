// 사용자 CSS 템플릿 원문 — 동적 import 로만 부른다 (specs/features/F-2093.md 7.4)
import tokensCss from '../styles/tokens.css?raw'
import { buildTemplateCss } from '../lib/userCssContract'

export const USER_CSS_TEMPLATE = buildTemplateCss(tokensCss)
