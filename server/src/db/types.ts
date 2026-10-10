import {
  ColumnType,
  Generated,
  GeneratedAlways,
  Insertable,
  JSONColumnType,
  Selectable,
  Updateable,
} from 'kysely'

export interface Database {
    users: UsersTable
    session: SessionTable
    playlist_sources: PlaylistSourcesTable
    channels: ChannelsTable
    xmltv_sources: XmltvSourcesTable
    xmltv_channels: XmltvChannelsTable
    xmltv_programs: XmltvProgramsTable
    channel_guide_overrides: ChannelGuideOverridesTable
}

export interface UsersTable {
  id: Generated<string>
  username: string
  password_hash: string
  role: 'admin' | 'user'
  session_version: number
  disabled_at: ColumnType<Date | null, Date | undefined, Date | null>
  created_at: Generated<Date>
}

export type User = Selectable<UsersTable>
export type NewUser = Insertable<UsersTable>
export type UserUpdate = Updateable<UsersTable>

export interface SessionTable {
  sid: string
  sess: JSONColumnType<any>
  expire: Date
}

export type Session = Selectable<SessionTable>
export type NewSession = Insertable<SessionTable>
export type SessionUpdate = Updateable<SessionTable>

export interface PlaylistSourcesTable {
  id: Generated<string>
  owner_id: string
  url: string
  name: string
  refresh_interval: number | null
  refresh_status: Generated<'queued' | 'healthy' | 'stale' | 'failed'>
  last_attempt_at: Date | null
  last_success_at: Date | null
  last_failure_code: string | null
  lease_expires_at: Date | null
  next_refresh_at_utc: GeneratedAlways<Date | null>
  created_at: Generated<Date>
}

export type PlaylistSource = Selectable<PlaylistSourcesTable>
export type NewPlaylistSource = Insertable<PlaylistSourcesTable>
export type PlaylistSourceUpdate = Updateable<PlaylistSourcesTable>

export interface ChannelsTable {
  id: Generated<string>
  source_id: string
  name: string
  tvg_id: string | null
  group_title: string | null
  stream_url: string
  match_key: string
  created_at: Generated<Date>
}

export type Channel = Selectable<ChannelsTable>
export type NewChannel = Insertable<ChannelsTable>
export type ChannelUpdate = Updateable<ChannelsTable>

export interface XmltvSourcesTable {
  id: Generated<string>
  owner_id: string
  url: string
  refresh_interval: number | null
  refresh_status: Generated<'queued' | 'healthy' | 'stale' | 'failed'>
  last_attempt_at: Date | null
  last_success_at: Date | null
  last_failure_code: string | null
  lease_expires_at: Date | null
  created_at: Generated<Date>
}

export interface XmltvChannelsTable {
  id: Generated<string>
  source_id: string
  xmltv_id: string
  display_name: string
}

export interface XmltvProgramsTable {
  id: Generated<string>
  channel_id: string
  title: string
  starts_at: Date
  ends_at: Date
}

export interface ChannelGuideOverridesTable {
  channel_id: string
  xmltv_channel_id: string
}
