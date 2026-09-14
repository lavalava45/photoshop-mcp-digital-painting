<script setup lang="ts">
import { ref } from 'vue';
import { MessageSquarePlus, MoreHorizontal, Pencil, Settings2, Trash2 } from 'lucide-vue-next';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Badge } from '@/components/ui/badge';
import AdobeAppIcon, { type AdobeApp as AdobeAppId } from '@/components/AdobeAppIcon.vue';
import type { ChatSummary } from '@/lib/api';

interface AdobeApp {
  id: AdobeAppId;
  name: string;
  active: boolean;
}

const props = defineProps<{
  chats: ChatSummary[];
  activeChatId: string | null;
}>();

const emit = defineEmits<{
  'new-chat': [];
  select: [id: string];
  rename: [id: string, title: string];
  delete: [id: string];
  'open-settings': [];
}>();

const menuOpenFor = ref<string | null>(null);
const renamingId = ref<string | null>(null);
const renameDraft = ref('');

const adobeApps: AdobeApp[] = [
  { id: 'ps', name: 'Photoshop', active: true },
  { id: 'ai', name: 'Illustrator', active: false },
  { id: 'ae', name: 'After Effects', active: false },
  { id: 'pr', name: 'Premiere Pro', active: false },
  { id: 'id', name: 'InDesign', active: false },
  { id: 'xd', name: 'XD', active: false },
  { id: 'lr', name: 'Lightroom', active: false },
];

function toggleMenu(id: string, event: Event): void {
  event.stopPropagation();
  menuOpenFor.value = menuOpenFor.value === id ? null : id;
}

function startRename(chat: ChatSummary, event: Event): void {
  event.stopPropagation();
  renamingId.value = chat.id;
  renameDraft.value = chat.title;
  menuOpenFor.value = null;
}

function commitRename(id: string): void {
  const title = renameDraft.value.trim();
  if (title) emit('rename', id, title);
  renamingId.value = null;
}

function cancelRename(): void {
  renamingId.value = null;
}

function onDelete(id: string, event: Event): void {
  event.stopPropagation();
  menuOpenFor.value = null;
  emit('delete', id);
}

function formatDate(ts: number): string {
  const d = new Date(ts);
  const today = new Date();
  if (d.toDateString() === today.toDateString()) {
    return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  }
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
</script>

<template>
  <aside
    class="flex h-screen w-[260px] shrink-0 flex-col border-r border-border bg-card/40"
    @click="menuOpenFor = null"
  >
    <div class="flex h-14 shrink-0 items-center gap-2 border-b border-border px-3">
      <Popover>
        <PopoverTrigger as-child>
          <button
            class="flex items-center gap-2 rounded-md transition-colors hover:bg-accent/50 p-1 -ml-1"
            title="Adobe Creative Cloud Apps"
          >
            <AdobeAppIcon app="ps" :size="28" />
            <span class="text-sm font-semibold">Photoshop MCP</span>
          </button>
        </PopoverTrigger>
        <PopoverContent align="start" class="w-80">
          <div class="space-y-3">
            <div>
              <h4 class="text-sm font-semibold mb-1">Adobe Creative Cloud</h4>
              <p class="text-xs text-muted-foreground">
                MCP integrations for Adobe applications
              </p>
            </div>
            <div class="grid grid-cols-3 gap-2">
              <button
                v-for="app in adobeApps"
                :key="app.id"
                :disabled="!app.active"
                class="group relative flex flex-col items-center gap-2 rounded-lg border border-border p-3 transition-all hover:border-primary/50 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:border-border"
                :class="{ 'border-primary bg-primary/5': app.active }"
              >
                <AdobeAppIcon :app="app.id" :size="32" />
                <span class="text-xs text-center">{{ app.name }}</span>
                <Badge
                  v-if="!app.active"
                  variant="secondary"
                  class="absolute -top-1 -right-1 text-[9px] px-1 py-0 h-4"
                >
                  Soon
                </Badge>
              </button>
            </div>
          </div>
        </PopoverContent>
      </Popover>
    </div>

    <div class="px-3 pt-3">
      <Button
        class="w-full justify-start gap-2 border-dashed"
        variant="outline"
        @click="emit('new-chat')"
      >
        <MessageSquarePlus class="size-4" />
        New chat
      </Button>
    </div>

    <div class="scrollbar-none mt-3 min-h-0 flex-1 overflow-y-auto px-2">
      <div v-if="props.chats.length === 0" class="px-2 py-6 text-center text-xs text-muted-foreground">
        No chats yet.
      </div>
      <div v-else class="space-y-0.5">
        <div
          v-for="chat in props.chats"
          :key="chat.id"
          class="group relative flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-accent"
          :class="{ 'bg-accent': chat.id === props.activeChatId }"
          @click="emit('select', chat.id)"
        >
          <div class="min-w-0 flex-1">
            <input
              v-if="renamingId === chat.id"
              v-model="renameDraft"
              class="w-full rounded border border-input bg-background px-1 py-0.5 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
              autofocus
              @click.stop
              @blur="commitRename(chat.id)"
              @keydown.enter.prevent="commitRename(chat.id)"
              @keydown.escape.prevent="cancelRename"
            />
            <div v-else class="truncate" :title="chat.title">{{ chat.title }}</div>
            <div class="text-[10px] text-muted-foreground">
              {{ formatDate(chat.updatedAt) }} · {{ chat.provider }}
            </div>
          </div>

          <button
            class="invisible flex size-6 items-center justify-center rounded text-muted-foreground hover:bg-background group-hover:visible"
            :class="{ visible: menuOpenFor === chat.id }"
            @click="toggleMenu(chat.id, $event)"
          >
            <MoreHorizontal class="size-3.5" />
          </button>

          <div
            v-if="menuOpenFor === chat.id"
            class="absolute right-1 top-9 z-10 w-32 rounded-md border border-border bg-popover p-1 text-sm shadow-md"
            @click.stop
          >
            <button
              class="flex w-full items-center gap-2 rounded px-2 py-1 text-left hover:bg-accent"
              @click="startRename(chat, $event)"
            >
              <Pencil class="size-3.5" />
              Rename
            </button>
            <button
              class="flex w-full items-center gap-2 rounded px-2 py-1 text-left text-destructive hover:bg-destructive/10"
              @click="onDelete(chat.id, $event)"
            >
              <Trash2 class="size-3.5" />
              Delete
            </button>
          </div>
        </div>
      </div>
    </div>

    <div class="border-t border-border p-2">
      <Button variant="ghost" size="sm" class="w-full justify-start gap-2" @click="emit('open-settings')">
        <Settings2 class="size-4" />
        Settings
      </Button>
      <div class="my-2 border-t border-border" />
      <p class="text-center text-[11px] text-muted-foreground">
        <a
          href="https://github.com/lavalava45/photoshop-mcp-digital-painting"
          target="_blank"
          rel="noopener noreferrer"
          class="transition-colors hover:text-foreground"
        >
          Fork GitHub
        </a>
        ·
        <a
          href="https://github.com/alisaitteke/photoshop-mcp"
          target="_blank"
          rel="noopener noreferrer"
          class="transition-colors hover:text-foreground"
        >
          Upstream
        </a>
      </p>
    </div>
  </aside>
</template>
