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
  ram: {
    total: number;
    used : number;
    time: string; 
  };
  cpu: {
    total: number;
    used : number;
    time: string; 
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
