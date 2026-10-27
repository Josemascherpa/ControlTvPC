export interface MediaLibrary {
  query(params: URLSearchParams): Promise<Contracts.LibraryReply>;
}
