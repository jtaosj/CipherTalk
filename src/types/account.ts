export interface AccountProfile {
  id: string
  wxid: string
  dbPath: string
  decryptKey: string
  cachePath: string
  imageXorKey: string
  imageAesKey: string
  displayName: string
  createdAt: number
  updatedAt: number
  lastUsedAt: number
}

export type AccountProfileInput = Omit<AccountProfile, 'id' | 'createdAt' | 'updatedAt' | 'lastUsedAt'>

export type AccountProfilePatch = Partial<AccountProfileInput> & {
  displayName?: string
}
