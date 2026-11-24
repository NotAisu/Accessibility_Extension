<script lang="ts">
	import ArrowRightIcon from "@lucide/svelte/icons/arrow-right";
	import { badgeVariants } from "$lib/registry/ui/badge/index.js";
	import { cn } from "$lib/utils.js";
</script>

<a tabindex="1" href="/docs/changelog" class={cn(badgeVariants({ variant: "secondary", class: "bg-muted" }))}>
	Trace, Code Block and AI Elements <ArrowRightIcon />
</a>
