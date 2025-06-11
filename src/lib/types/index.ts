export type TCredentials = { 
  token : string; 
  secret : string; 
  bucket : string;
}

export type TSetup = { 
  logo ?: {
    index?: string;
    login?: string;
    fav?: string;
  }; 
  name ?: string;
  title ?: string; 
  subtitle ?: string; 
  description ?:string 
}

export type TMonitors = { 
  host : string | null; 
  memory : {  
    total : number; 
    heapTotal : number;
    heapUsed: number ;
    external : number ; 
    rss : number;
  },
  cpu : { 
    total : number;
    max: number;
    min: number;
    avg: number;
    speed: number; 
  }
}

export type TLoginCrentials = {
  username : string; 
  password : string;
}
