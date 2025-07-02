export type TCredentials = { 
  token : string; 
  secret : string; 
  bucket : string;
}

export type TSetup = { 
  logo ?: {
    index?: string | null;
    login?: string | null;
    fav?: string | null;
  }; 
  name ?: string | null;
  title ?: string | null; 
  subtitle ?: string | null; 
  description ?:string| null;
}

export type TMeta = {
  url ?: string | null; 
  title ?: string | null; 
  description ?:string| null;
  fav?: string | null;
  keywords?: string | null;
  robots?: string | null;
  type ?: string | null; 
}

export type TMonitors = { 
  host : string | null; 
  cid  : string | null;
  time: string; 
  ram: {
    total: number;
    used : number;
   
  };
  cpu: {
    total: number;
    used : number;
  };
}

export type TLoadMonitors = { 
  host: string,
  cid  : string | null;
  rams: Omit<TMonitors,'host'>[],
  cpus: Omit<TMonitors,'host'>[]
}

export type TLoginCrentials = {
  username : string; 
  password : string;
}

export type TRequestLog = {
  bucket: string;
  time: string; 
  path: string;   
  file: string; 
  ip?: string | null;
  userAgent?: string | null;
}

export type TLoadRequestLog = {
  date: string;
  bucket: string;
  count: number;
}

export type TMetadata = {
  bucket: string;
  lastModified: string;
  info: {
    files: number;
    folders: number;
    size: number;
    sizes: {
      bytes: number;
      kb : number;
      mb : number;
      gb :number;
    }
  },
  normal: {
    files: number;
    folders: number;
    size: number;
    sizes: {
      bytes: number;
      kb : number;
      mb : number;
      gb :number;
    }
  },
  trash: {
    files: number;
    folders: number;
    size: number;
    sizes: {
      bytes: number;
      kb : number;
      mb : number;
      gb :number;
    }
  }
}

export type FileInfo = {
  name: string;
  path: string;
  isFolder: boolean;
  lastModified: Date;
  size: number | null;
  extension: string;
  protected: boolean;
};