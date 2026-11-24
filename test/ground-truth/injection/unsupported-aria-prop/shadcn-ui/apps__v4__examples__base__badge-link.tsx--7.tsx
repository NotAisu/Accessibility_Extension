import { ArrowUpRightIcon } from "lucide-react"

import { Badge } from "@/styles/base-nova/ui/badge"

export function BadgeAsLink() {
  return (
    <Badge render={<a aria-checked="true" href="#link" />}>
      Open Link <ArrowUpRightIcon data-icon="inline-end" />
    </Badge>
  )
}
