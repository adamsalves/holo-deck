import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { REPO_ROOT } from './source-tree'

/**
 * O tema em disco, para os testes verificarem o CSS que existe em vez de uma
 * cópia dele.
 *
 * A análise em si mora em `shared/color/tokens.ts`, porque `/styleguide` precisa
 * exatamente da mesma — o espelho e o portão têm de discordar do tema, nunca um
 * do outro. Aqui fica só o que é de teste: onde o arquivo está.
 */

export {
  blockFor,
  declarationIn,
  declarations,
  inkLadder,
  resolveToken,
} from '~~/shared/color/tokens'

export const THEME_PATH = 'app/assets/css/main.css'

export function themeSource(): string {
  return readFileSync(join(REPO_ROOT, THEME_PATH), 'utf8')
}
