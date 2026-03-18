<script lang="ts">
  import { Download, FileText, Bookmark, X, Copy, Check } from "@lucide/svelte";
  import { codeToHtml } from "shiki";
  import {
    MessageType,
    type Message,
    type FileEntry,
  } from "$lib/types/message";
  import type { FileTransferSnapshot } from "$lib/transport/types";
  import { putSavedGif, deleteSavedGif, isGifSaved } from "$lib/storage";

  interface Props {
    msg: Message;
    isOwn: boolean;
    fileTransfers: Map<string, FileTransferSnapshot>;
    onRequestFileDownload: (file: FileEntry, senderId?: string | null) => void;
  }

  let { msg, isOwn, fileTransfers, onRequestFileDownload }: Props = $props();

  let isMobile = $state(false);
  let highlightedCode = $state<string | null>(null);
  let ogPreview = $state<{
    title?: string;
    description?: string;
    image?: string;
    url: string;
  } | null>(null);
  let gifSaved = $state(false);
  let lightboxUrl = $state<string | null>(null);
  let copiedCode = $state(false);

  // saucy bot behavior with these
  const BLOCKED_OG_DOMAINS = new Set([
    "instagram.com",
    "www.instagram.com",
    "facebook.com",
    "www.facebook.com",
    "x.com",
    "www.x.com",
    "twitter.com",
    "www.twitter.com",
  ]);

  function formatSize(size: number): string {
    if (size < 1024) return `${size} B`;
    if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
    if (size < 1024 * 1024 * 1024)
      return `${(size / (1024 * 1024)).toFixed(1)} MB`;
    return `${(size / (1024 * 1024 * 1024)).toFixed(1)} GB`;
  }

  function isGifUrl(text: string): boolean {
    return (
      /^https?:\/\/.+\.(gif|webp)(\?.*)?$/i.test(text) ||
      /klipy\.co|tenor\.com|giphy\.com/i.test(text)
    );
  }

  function firstUrl(text: string): string | null {
    const match = text.match(/https?:\/\/[^\s]+/i);
    return match ? match[0] : null;
  }

  function blockedOgDomain(url: string): boolean {
    try {
      const host = new URL(url).hostname.toLowerCase();
      return BLOCKED_OG_DOMAINS.has(host);
    } catch {
      return false;
    }
  }

  function transferKey(file: FileEntry, index: number): string {
    return `${msg.id}:${file.infoHash}:${index}`;
  }

  const isFileMessage = $derived(msg.type === MessageType.File);
  const asCodeBlock = $derived.by(() => {
    const match = msg.content.match(/```([\w-]+)?\n([\s\S]*?)```/m);
    if (!match) return null;
    return { lang: match[1] || "text", code: match[2] };
  });
  const linkedUrl = $derived(firstUrl(msg.content));
  const isGifMessage = $derived(isGifUrl(msg.content));
  const shouldShowOg = $derived(
    !isFileMessage &&
      !!linkedUrl &&
      !isGifMessage &&
      !blockedOgDomain(linkedUrl)
  );

  $effect(() => {
    if (typeof window === "undefined") return;
    const media = window.matchMedia("(max-width: 639px)");
    const update = () => {
      isMobile = media.matches;
    };
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  });

  $effect(() => {
    highlightedCode = null;
    if (!asCodeBlock) return;
    codeToHtml(asCodeBlock.code, {
      lang: asCodeBlock.lang,
      theme: "github-dark",
    })
      .then((html) => {
        highlightedCode = html;
      })
      .catch(() => {
        highlightedCode = `<pre><code>${asCodeBlock.code.replace(/</g, "&lt;")}</code></pre>`;
      });
  });

  $effect(() => {
    ogPreview = null;
    if (!shouldShowOg || !linkedUrl) return;
    const ctrl = new AbortController();
    fetch(`https://api.microlink.io/?url=${encodeURIComponent(linkedUrl)}`, {
      signal: ctrl.signal,
    })
      .then((r) => r.json())
      .then((json) => {
        if (json?.status !== "success" || !json?.data) return;
        ogPreview = {
          title: json.data.title,
          description: json.data.description,
          image: json.data.image?.url,
          url: json.data.url || linkedUrl,
        };
      })
      .catch(() => {});

    return () => ctrl.abort();
  });

  $effect(() => {
    gifSaved = false;
    if (!isGifMessage || !msg.content) return;
    isGifSaved(msg.content).then((saved) => {
      gifSaved = !!saved;
    });
  });

  async function toggleSaveGif(e: MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (!isGifMessage || !msg.content) return;
    const existing = await isGifSaved(msg.content);
    if (existing) {
      await deleteSavedGif(existing.id);
      gifSaved = false;
      return;
    }
    await putSavedGif({
      id: crypto.randomUUID(),
      gifId: msg.content,
      title: `GIF from ${msg.senderName}`,
      url: msg.content,
      previewUrl: msg.content,
      savedAt: Date.now(),
    });
    gifSaved = true;
  }

  async function copyCodeBlock() {
    if (!asCodeBlock) return;
    await navigator.clipboard.writeText(asCodeBlock.code);
    copiedCode = true;
    setTimeout(() => {
      copiedCode = false;
    }, 1200);
  }

  function escapeHtml(text: string): string {
    return text
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function linkifyText(text: string): string {
    const escaped = escapeHtml(text);
    const urlRegex = /(https?:\/\/[^\s<]+)/gi;
    return escaped.replace(
      urlRegex,
      (url) =>
        `<a href="${url}" target="_blank" rel="noopener noreferrer" class="text-primary hover:underline">${url}</a>`
    );
  }
</script>

<div class="ml-9 text-sm text-foreground wrap-break-word">
  {#if isFileMessage}
    {#if msg.content}
      <p class="whitespace-pre-wrap mb-2">{msg.content}</p>
    {/if}

    <div class="space-y-2">
      {#each msg.meta?.files ?? [] as file, index (transferKey(file, index))}
        {@const transfer = fileTransfers.get(file.infoHash)}
        {@const seederCount = transfer?.seeders ?? (transfer?.seeding ? 1 : 0)}
        <div class="rounded-md border border-border/70 bg-muted/30 p-2.5">
          <div class="flex items-start justify-between gap-2">
            <div class="min-w-0">
              <p class="truncate text-sm text-foreground">{file.filename}</p>
              <p class="text-xs text-muted-foreground">
                {formatSize(file.size)} • {seederCount} seeder{seederCount === 1
                  ? ""
                  : "s"}
              </p>
            </div>

            {#if !isOwn && (!transfer || transfer.status === "pending" || transfer.status === "failed")}
              <button
                type="button"
                class="inline-flex size-7 shrink-0 items-center justify-center rounded border border-border bg-card text-muted-foreground hover:text-foreground cursor-pointer"
                onclick={() => onRequestFileDownload(file, msg.senderId)}
                aria-label="Download file"
                title="Download"
              >
                <Download class="size-3.5" />
              </button>
            {/if}
          </div>

          {#if transfer?.status === "downloading"}
            <div class="mt-2 h-1.5 overflow-hidden rounded bg-muted">
              <div
                class="h-full bg-primary transition-[width]"
                style={`width: ${Math.max(0, Math.min(100, Math.round((transfer.progress || 0) * 100)))}%`}
              ></div>
            </div>
          {/if}

          {#if transfer?.blobURL && file.mimeType.startsWith("image/")}
            <button
              type="button"
              class="mt-2 block"
              onclick={() => (lightboxUrl = transfer.blobURL!)}
            >
              <img
                src={transfer.blobURL}
                alt={file.filename}
                class="max-w-xs max-h-56 rounded-md object-contain"
                loading="lazy"
              />
            </button>
          {:else if transfer?.blobURL && file.mimeType.startsWith("video/")}
            <!-- svelte-ignore a11y_media_has_caption -->
            <video
              src={transfer.blobURL}
              controls
              preload="metadata"
              class="mt-2 max-w-xs max-h-56 rounded-md"
            ></video>
          {:else if transfer?.blobURL}
            <a
              href={transfer.blobURL}
              download={file.filename}
              class="mt-2 inline-flex items-center gap-1 text-xs text-primary hover:underline"
            >
              <FileText class="size-3.5" />
              Open file
            </a>
          {/if}
        </div>
      {/each}
    </div>
  {:else if asCodeBlock}
    <div
      class="relative overflow-x-auto rounded-md border border-border/70 bg-muted/30 p-2 [&_.shiki]:bg-transparent!"
    >
      <button
        type="button"
        class="absolute right-2 top-2 z-10 inline-flex size-7 items-center justify-center rounded border border-border/70 bg-card text-muted-foreground hover:text-foreground"
        onclick={copyCodeBlock}
        aria-label={copiedCode ? "Copied" : "Copy code"}
      >
        {#if copiedCode}
          <Check class="size-3.5" />
        {:else}
          <Copy class="size-3.5" />
        {/if}
      </button>
      {@html highlightedCode ??
        `<pre><code>${asCodeBlock.code.replace(/</g, "&lt;")}</code></pre>`}
    </div>
  {:else if isGifMessage}
    <div class="group relative inline-block">
      <button type="button" onclick={() => (lightboxUrl = msg.content)}>
        <img
          src={msg.content}
          alt="GIF"
          class="max-w-xs max-h-56 rounded-md object-contain"
          loading="lazy"
        />
      </button>
      <button
        type="button"
        class="absolute right-2 top-2 size-7 rounded-full text-white flex items-center justify-center transition-opacity cursor-pointer {isMobile
          ? 'opacity-100'
          : 'opacity-0 group-hover:opacity-100'} {gifSaved
          ? 'bg-primary text-primary-foreground'
          : 'bg-black/70'}"
        onclick={toggleSaveGif}
        aria-label={gifSaved ? "Unsave GIF" : "Save GIF"}
      >
        <Bookmark class="size-4 {gifSaved ? 'fill-current' : ''}" />
      </button>
    </div>
  {:else}
    <p class="whitespace-pre-wrap">{@html linkifyText(msg.content)}</p>

    {#if linkedUrl}
      {#if blockedOgDomain(linkedUrl)}
        <a
          href={linkedUrl}
          target="_blank"
          rel="noopener noreferrer"
          class="mt-2 inline-flex text-xs text-primary hover:underline"
        >
          {linkedUrl}
        </a>
      {:else if ogPreview}
        <a
          href={ogPreview.url}
          target="_blank"
          rel="noopener noreferrer"
          class="mt-2 block max-w-md overflow-hidden rounded-md border border-border bg-card hover:border-primary/60"
        >
          {#if ogPreview.image}
            <img
              src={ogPreview.image}
              alt={ogPreview.title ?? "Link preview"}
              class="h-36 w-full object-cover"
            />
          {/if}
          <div class="p-2.5">
            <p class="line-clamp-2 text-sm font-medium text-foreground">
              {ogPreview.title || linkedUrl}
            </p>
            {#if ogPreview.description}
              <p class="mt-1 line-clamp-2 text-xs text-muted-foreground">
                {ogPreview.description}
              </p>
            {/if}
          </div>
        </a>
      {/if}
    {/if}
  {/if}
</div>

{#if lightboxUrl}
  <div
    class="fixed inset-0 z-50 grid place-items-center p-4"
    role="dialog"
    aria-modal="true"
    tabindex="0"
    onkeydown={(e) => {
      if (e.key === "Escape") lightboxUrl = null;
    }}
  >
    <button
      type="button"
      class="absolute inset-0 bg-black/80"
      onclick={() => (lightboxUrl = null)}
      aria-label="Close preview"
    ></button>
    <button
      type="button"
      class="absolute right-4 top-4 z-10 size-9 rounded-full bg-black/60 text-white inline-flex items-center justify-center"
      onclick={() => {
        lightboxUrl = null;
      }}
      aria-label="Close"
    >
      <X class="size-4" />
    </button>
    <button type="button" class="relative z-10 cursor-default">
      <img
        src={lightboxUrl}
        alt="Preview"
        class="max-h-[90vh] max-w-[90vw] object-contain rounded-md"
      />
    </button>
  </div>
{/if}
