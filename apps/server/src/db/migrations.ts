/**
 * Migrations are plain SQL kept in TypeScript so the compiled output needs no
 * extra asset-copy step in Docker. Each entry is applied once, in order.
 */
export type Migration = { id: string; sql: string };

export const migrations: Migration[] = [
  {
    id: '0001_init',
    sql: /* sql */ `
      create table if not exists users (
        id uuid primary key default gen_random_uuid(),
        username text not null,
        display_name text not null,
        password_hash text not null,
        bio text not null default '',
        avatar_key text,
        is_admin boolean not null default false,
        created_at timestamptz not null default now(),
        last_seen_at timestamptz not null default now(),
        settings jsonb not null default '{}'::jsonb
      );
      create unique index if not exists users_username_lower_idx on users (lower(username));

      create table if not exists invites (
        code text primary key,
        created_by uuid references users(id) on delete set null,
        note text not null default '',
        max_uses integer not null default 1,
        uses integer not null default 0,
        expires_at timestamptz,
        revoked boolean not null default false,
        created_at timestamptz not null default now()
      );

      create table if not exists sessions (
        id uuid primary key default gen_random_uuid(),
        user_id uuid not null references users(id) on delete cascade,
        refresh_hash text not null unique,
        family uuid not null,
        user_agent text not null default '',
        ip text not null default '',
        created_at timestamptz not null default now(),
        last_used_at timestamptz not null default now(),
        revoked_at timestamptz
      );
      create index if not exists sessions_user_idx on sessions (user_id);

      create table if not exists chats (
        id uuid primary key default gen_random_uuid(),
        type text not null check (type in ('direct', 'group')),
        title text not null default '',
        avatar_key text,
        owner_id uuid references users(id) on delete set null,
        direct_key text unique,
        invite_token text unique,
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now(),
        last_message_at timestamptz
      );

      create table if not exists chat_members (
        chat_id uuid not null references chats(id) on delete cascade,
        user_id uuid not null references users(id) on delete cascade,
        role text not null default 'member' check (role in ('owner', 'admin', 'member')),
        joined_at timestamptz not null default now(),
        last_read_seq bigint not null default 0,
        muted_until timestamptz,
        primary key (chat_id, user_id)
      );
      create index if not exists chat_members_user_idx on chat_members (user_id);

      create table if not exists messages (
        id uuid primary key default gen_random_uuid(),
        chat_id uuid not null references chats(id) on delete cascade,
        seq bigint not null,
        sender_id uuid references users(id) on delete set null,
        kind text not null default 'text'
          check (kind in ('text', 'image', 'video', 'audio', 'voice', 'file', 'system')),
        body text not null default '',
        meta jsonb not null default '{}'::jsonb,
        reply_to uuid references messages(id) on delete set null,
        edited_at timestamptz,
        deleted_at timestamptz,
        created_at timestamptz not null default now(),
        unique (chat_id, seq)
      );
      create index if not exists messages_chat_seq_idx on messages (chat_id, seq desc);
      create index if not exists messages_search_idx
        on messages using gin (to_tsvector('simple', body));

      create table if not exists attachments (
        id uuid primary key default gen_random_uuid(),
        owner_id uuid references users(id) on delete set null,
        message_id uuid references messages(id) on delete cascade,
        name text not null,
        mime text not null,
        size bigint not null,
        kind text not null,
        storage_key text,
        width integer,
        height integer,
        duration double precision,
        status text not null default 'pending' check (status in ('pending', 'ready')),
        created_at timestamptz not null default now()
      );
      create index if not exists attachments_message_idx on attachments (message_id);

      create table if not exists message_reactions (
        message_id uuid not null references messages(id) on delete cascade,
        user_id uuid not null references users(id) on delete cascade,
        emoji text not null,
        created_at timestamptz not null default now(),
        primary key (message_id, user_id, emoji)
      );

      create table if not exists calls (
        id uuid primary key default gen_random_uuid(),
        chat_id uuid not null references chats(id) on delete cascade,
        initiator_id uuid references users(id) on delete set null,
        kind text not null check (kind in ('audio', 'video')),
        status text not null default 'ringing'
          check (status in ('ringing', 'active', 'ended', 'missed', 'declined')),
        created_at timestamptz not null default now(),
        started_at timestamptz,
        ended_at timestamptz
      );
      create index if not exists calls_chat_idx on calls (chat_id, created_at desc);

      create table if not exists call_participants (
        call_id uuid not null references calls(id) on delete cascade,
        user_id uuid not null references users(id) on delete cascade,
        state text not null default 'invited'
          check (state in ('invited', 'joined', 'left', 'declined', 'missed')),
        joined_at timestamptz,
        left_at timestamptz,
        primary key (call_id, user_id)
      );

      create table if not exists push_subscriptions (
        id uuid primary key default gen_random_uuid(),
        user_id uuid not null references users(id) on delete cascade,
        endpoint text not null unique,
        p256dh text not null,
        auth text not null,
        created_at timestamptz not null default now()
      );
      create index if not exists push_subscriptions_user_idx on push_subscriptions (user_id);
    `,
  },
  {
    id: '0002_message_meta_index',
    sql: /* sql */ `
      create index if not exists messages_meta_client_idx
        on messages ((meta ->> 'clientId'))
        where meta ? 'clientId';
    `,
  },
  {
    id: '0003_user_status',
    sql: /* sql */ `
      alter table users add column if not exists status text not null default 'active';

      do $$
      begin
        alter table users add constraint users_status_check
          check (status in ('pending', 'active', 'disabled'));
      exception
        when duplicate_object then null;
      end $$;

      create index if not exists users_status_idx on users (status);
    `,
  },
  {
    id: '0004_support_and_message_extras',
    sql: /* sql */ `
      -- Visitors without an account who talk to the admin from /support
      create table if not exists guests (
        id uuid primary key default gen_random_uuid(),
        token_hash text not null unique,
        display_name text not null,
        note text not null default '',
        created_at timestamptz not null default now(),
        last_seen_at timestamptz not null default now(),
        converted_user_id uuid references users(id) on delete set null
      );

      create table if not exists support_threads (
        id uuid primary key default gen_random_uuid(),
        guest_id uuid not null unique references guests(id) on delete cascade,
        status text not null default 'open' check (status in ('open', 'closed')),
        unread_for_admin integer not null default 0,
        unread_for_guest integer not null default 0,
        assigned_admin_id uuid references users(id) on delete set null,
        converted_user_id uuid references users(id) on delete set null,
        last_message_at timestamptz,
        created_at timestamptz not null default now()
      );
      create index if not exists support_threads_activity_idx
        on support_threads (coalesce(last_message_at, created_at) desc);

      create table if not exists support_messages (
        id uuid primary key default gen_random_uuid(),
        thread_id uuid not null references support_threads(id) on delete cascade,
        author text not null check (author in ('guest', 'admin', 'system')),
        admin_id uuid references users(id) on delete set null,
        body text not null,
        created_at timestamptz not null default now()
      );
      create index if not exists support_messages_thread_idx
        on support_messages (thread_id, created_at);

      -- Pinned message (Telegram-style) per chat
      alter table chats add column if not exists pinned_message_id uuid
        references messages(id) on delete set null;

      -- "Delete for me" hides a message only for one member
      create table if not exists message_hidden (
        message_id uuid not null references messages(id) on delete cascade,
        user_id uuid not null references users(id) on delete cascade,
        created_at timestamptz not null default now(),
        primary key (message_id, user_id)
      );

      -- Per-member archive flag
      alter table chat_members add column if not exists archived boolean not null default false;

      -- Forward provenance
      alter table messages add column if not exists forward_from_name text;
    `,
  },
];
