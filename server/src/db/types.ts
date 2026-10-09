import {
  ColumnType,
  Generated,
  Insertable,
  JSONColumnType,
  Selectable,
  Updateable,
} from 'kysely'

export interface Database {
    users: UsersTable
    session: SessionTable
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
