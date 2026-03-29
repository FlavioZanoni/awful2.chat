<script lang="ts">
  import { transportState, peerIdToDid, selfId, isRelayed } from "$lib/transport.svelte";
  import { profileStore, loadProfile } from "$lib/profile.svelte";
  import { identityStore } from "$lib/identity.svelte";
  import { Users, Workflow } from "@lucide/svelte";
  import { ScrollArea } from "$lib/components/ui/scroll-area";

  interface User {
    did: string;
    name: string;
    avatarUrl: string | null;
    isOnline: boolean;
    isSelf: boolean;
    isRelayed: boolean;
  }

  const { roomUsers, peers, peerNames, peerAvatars } = $derived(transportState);

  const selfDid = $derived(selfId());
  const ownDid = $derived(identityStore.did);

  $effect(() => {
    loadProfile();
  });

  const users = $derived.by(() => {
    const allUsers: User[] = [];

    for (const did of roomUsers) {
      const isSelf = did === selfDid || did === ownDid;
      const connectedPeerId = peers.find((peerId) => peerIdToDid(peerId) === did);
      const isOnline = isSelf || !!connectedPeerId;
      const userIsRelayed = !!connectedPeerId && isRelayed(connectedPeerId);

      let name: string;
      let avatarUrl: string | null = null;

      if (isSelf) {
        name = profileStore.nickname || "You";
        avatarUrl = profileStore.avatarUrl || null;
      } else {
        name = peerNames.get(did) || did.slice(0, 12);
        avatarUrl = peerAvatars.get(did) || null;
      }

      allUsers.push({
        did,
        name,
        avatarUrl,
        isOnline,
        isSelf,
        isRelayed: userIsRelayed,
      });
    }

    return allUsers.sort((a, b) => {
      if (a.isSelf && !b.isSelf) return -1;
      if (!a.isSelf && b.isSelf) return 1;
      if (a.isOnline && !b.isOnline) return -1;
      if (!a.isOnline && b.isOnline) return 1;
      return a.name.localeCompare(b.name);
    });
  });

  function getInitials(name: string): string {
    return name.charAt(0).toUpperCase();
  }
</script>

<aside class="w-60 border-l border-border bg-background flex flex-col h-full shrink-0">
  <div class="border-b border-border p-3 flex items-center gap-2">
    <Users class="size-4 text-muted-foreground" />
    <span class="text-sm font-medium">Users</span>
    <span class="text-xs text-muted-foreground ml-auto">
      {users.length}
    </span>
  </div>

  <ScrollArea class="flex-1">
    <div class="p-2 space-y-1">
      {#each users as user (user.did)}
        <div
          class="flex items-center gap-3 px-2 py-1.5 rounded-md transition-colors {user.isOnline
            ? 'hover:bg-muted/50'
            : 'opacity-60 hover:bg-muted/30'}"
        >
          <div class="relative shrink-0">
            <div
              class="size-8 rounded-full overflow-hidden flex items-center justify-center text-xs font-semibold
                {user.isSelf
                  ? 'bg-primary/20 text-primary'
                  : 'bg-secondary text-secondary-foreground'}"
            >
              {#if user.avatarUrl}
                <img
                  src={user.avatarUrl}
                  alt={user.name}
                  class="size-full object-cover"
                />
              {:else}
                {getInitials(user.name)}
              {/if}
            </div>
            <div
              class="absolute -bottom-0.5 -right-0.5 size-3 rounded-full border-2 border-background {user.isOnline
                ? 'bg-green-500'
                : 'bg-muted-foreground'}"
            ></div>
          </div>
          <div class="min-w-0 flex-1">
            <div class="text-sm font-medium truncate {user.isSelf ? 'text-primary' : ''} flex items-center gap-1">
              {user.isSelf ? `${user.name} (You)` : user.name}
              {#if user.isRelayed}
                <Workflow class="size-3 text-blue-500 shrink-0" />
              {/if}
            </div>
            <div class="text-xs text-muted-foreground truncate">
              {user.isOnline ? "Online" : "Offline"}
            </div>
          </div>
        </div>
      {/each}

      {#if users.length === 0}
        <div class="text-center py-8 text-sm text-muted-foreground">
          No users in this room
        </div>
      {/if}
    </div>
  </ScrollArea>
</aside>
