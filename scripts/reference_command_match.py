# Kept equivalent to the text-only lexer in command-match.mjs. No execution.
def command_tokens(value,shell='bash'):
    if not isinstance(value,str) or len(value)>200:return None
    windows=shell in ('powershell','cmd');tokens=[];word='';quote='';started=False;index=0
    while index<len(value):
        char=value[index]
        if char=='\\' and not windows and quote!="'":
            index+=1
            if index>=len(value):return None
            word+=value[index];started=True
        elif quote:
            if char==quote:quote=''
            else:word+=char
        elif char in ('"',"'"):quote=char;started=True
        elif char.isspace():
            if started:tokens.append(word);word='';started=False
        else:word+=char;started=True
        index+=1
    if quote:return None
    if started:tokens.append(word)
    return [token.lower() if windows and (i==0 or __import__('re').match(r'^-[a-z]',token,__import__('re').I)) else token for i,token in enumerate(tokens)]
