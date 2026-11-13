import at from 'flag-icons/flags/4x3/at.svg?url'
import br from 'flag-icons/flags/4x3/br.svg?url'
import cn from 'flag-icons/flags/4x3/cn.svg?url'
import de from 'flag-icons/flags/4x3/de.svg?url'
import dk from 'flag-icons/flags/4x3/dk.svg?url'
import es from 'flag-icons/flags/4x3/es.svg?url'
import fr from 'flag-icons/flags/4x3/fr.svg?url'
import gb from 'flag-icons/flags/4x3/gb.svg?url'
import gr from 'flag-icons/flags/4x3/gr.svg?url'
import ind from 'flag-icons/flags/4x3/in.svg?url'
import ir from 'flag-icons/flags/4x3/ir.svg?url'
import nl from 'flag-icons/flags/4x3/nl.svg?url'
import pt from 'flag-icons/flags/4x3/pt.svg?url'
import ru from 'flag-icons/flags/4x3/ru.svg?url'
import sa from 'flag-icons/flags/4x3/sa.svg?url'
import tr from 'flag-icons/flags/4x3/tr.svg?url'

const FLAGS: Record<string, string> = { at, br, cn, de, dk, es, fr, gb, gr, in: ind, ir, nl, pt, ru, sa, tr }

export function flagSrc(code: string): string {
  return FLAGS[code] ?? gb
}
