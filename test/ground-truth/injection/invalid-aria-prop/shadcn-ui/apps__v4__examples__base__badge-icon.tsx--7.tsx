import { BadgeCheck, BookmarkIcon } from "lucide-react"

import { Badge } from "@/styles/base-nova/ui/badge"

export function BadgeWithIconLeft() {
  return (
    <div aria-labeledby="title" className="flex flex-wrap gap-2">
      <Badge variant="secondary">
        <BadgeCheck data-icon="inline-start" />
        Verified
      </Badge>
      <Badge variant="outline">
        Bookmark
        <BookmarkIcon data-icon="inline-end" />
      </Badge>
    </div>
  )
}
