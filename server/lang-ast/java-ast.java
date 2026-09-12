import com.sun.source.tree.*;
import com.sun.source.util.*;
import javax.tools.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.util.*;

public class JavaAst {
  static List<Map<String,Object>> entities = new ArrayList<>();
  static List<Map<String,Object>> imports = new ArrayList<>();
  static String escapeJson(String s) {
    if (s == null) return "null";
    StringBuilder sb = new StringBuilder(s.length() + 16);
    sb.append('"');
    for (int i = 0; i < s.length(); i++) {
      char c = s.charAt(i);
      switch (c) {
        case '"': sb.append("\\\""); break;
        case '\\': sb.append("\\\\"); break;
        case '\b': sb.append("\\b"); break;
        case '\f': sb.append("\\f"); break;
        case '\n': sb.append("\\n"); break;
        case '\r': sb.append("\\r"); break;
        case '\t': sb.append("\\t"); break;
        default:
          if (c < 0x20 || (c >= 0x7f && Character.isISOControl(c))) {
            sb.append(String.format("\\u%04x", (int) c));
          } else {
            sb.append(c);
          }
          break;
      }
    }
    sb.append('"');
    return sb.toString();
  }
  static String json(Object o) {
    if (o == null) return "null";
    if (o instanceof String) return escapeJson((String) o);
    if (o instanceof Number || o instanceof Boolean) return o.toString();
    if (o instanceof List) { StringBuilder b=new StringBuilder("["); for(Object x:(List<?>)o){if(b.length()>1)b.append(',');b.append(json(x));} return b.append(']').toString(); }
    if (o instanceof Map) { StringBuilder b=new StringBuilder("{"); for(var e:((Map<?,?>)o).entrySet()){if(b.length()>1)b.append(',');b.append(escapeJson(e.getKey().toString())).append(':').append(json(e.getValue()));} return b.append('}').toString(); }
    return escapeJson(String.valueOf(o));
  }
  static Map<String,Object> base(String kind, String name, CompilationUnitTree u, Tree t, SourcePositions sp) {
    Map<String,Object> x=new LinkedHashMap<>(); x.put("kind",kind);
    x.put("name",(name==null || name.isEmpty()) ? "(anonymous)" : name);
    long pos=(sp!=null)?sp.getStartPosition(u,t):Diagnostic.NOPOS;
    LineMap lm=u.getLineMap();
    long line=(pos==Diagnostic.NOPOS || lm==null)?-1:lm.getLineNumber(pos);
    long col=(pos==Diagnostic.NOPOS || lm==null)?-1:lm.getColumnNumber(pos);
    x.put("line",line<0?null:line); x.put("column",col<0?null:col); return x;
  }
  static void emitError(String msg, long line, long col) { Map<String,Object> x=new LinkedHashMap<>(); x.put("ok",false); x.put("language","java"); x.put("parser","javac"); x.put("strength","real-ast"); x.put("error",msg==null?"Java syntax error":msg); x.put("line",line<0?null:line); x.put("column",col<0?null:col); System.out.print(json(x)); }
  public static void main(String[] args) throws Exception {
    entities.clear();
    imports.clear();
    if(args.length<1 || args[0]==null || args[0].trim().isEmpty()){emitError("missing file argument",-1,-1);return;}
    Path filePath = Paths.get(args[0]);
    if(!Files.exists(filePath) || !Files.isRegularFile(filePath)){emitError("File not found or not a regular file: " + args[0],-1,-1);return;}
    JavaCompiler compiler=ToolProvider.getSystemJavaCompiler(); if(compiler==null){emitError("JDK compiler unavailable (running on JRE instead of JDK)",-1,-1);return;}
    DiagnosticCollector<JavaFileObject> diagnostics=new DiagnosticCollector<>();
    try(StandardJavaFileManager fm=compiler.getStandardFileManager(diagnostics,Locale.ROOT,StandardCharsets.UTF_8)) {
      Iterable<? extends JavaFileObject> fs=fm.getJavaFileObjects(filePath.toFile());
      List<String> options=Arrays.asList("-proc:none","-Xlint:none","-encoding","UTF-8");
      JavacTask task=(JavacTask)compiler.getTask(null,fm,diagnostics,options,null,fs);
      Iterable<? extends CompilationUnitTree> units;
      try { units=task.parse(); } catch(Exception e){ emitError(e.getMessage(),-1,-1); return; }
      for(Diagnostic<? extends JavaFileObject> d: diagnostics.getDiagnostics()) {
        if(d.getKind()==Diagnostic.Kind.ERROR){ emitError(d.getMessage(Locale.ROOT),d.getLineNumber(),d.getColumnNumber()); return; }
      }
      SourcePositions sp=Trees.instance(task).getSourcePositions();
      for(CompilationUnitTree u:units){
        new TreePathScanner<Void,Void>(){
          public Void visitClass(ClassTree n,Void v){
            String kind="class";
            Tree.Kind tk=n.getKind();
            if(tk==Tree.Kind.INTERFACE) kind="interface";
            else if(tk==Tree.Kind.ENUM) kind="enum";
            else if(tk==Tree.Kind.ANNOTATION_TYPE) kind="annotation";
            else if(tk.name().equals("RECORD")) kind="record";
            entities.add(base(kind,n.getSimpleName().toString(),u,n,sp));
            return super.visitClass(n,v);
          }
          public Void visitMethod(MethodTree n,Void v){
            String name=n.getName().toString();
            String kind=name.equals("<init>")?"constructor":"method";
            Map<String,Object>x=base(kind,name,u,n,sp);
            List<String> ps=new ArrayList<>();
            for(VariableTree p:n.getParameters()) ps.add(p.getName().toString());
            x.put("params",ps);
            entities.add(x);
            return super.visitMethod(n,v);
          }
        }.scan(u,null);
        for(ImportTree x:u.getImports()){
          Map<String,Object>m=new LinkedHashMap<>();
          m.put("source",x.getQualifiedIdentifier().toString());
          m.put("static",x.isStatic());
          long pos=(sp!=null)?sp.getStartPosition(u,x):Diagnostic.NOPOS;
          LineMap lm=u.getLineMap();
          long line=(pos==Diagnostic.NOPOS || lm==null)?-1:lm.getLineNumber(pos);
          long col=(pos==Diagnostic.NOPOS || lm==null)?-1:lm.getColumnNumber(pos);
          m.put("line",line<0?null:line);
          m.put("column",col<0?null:col);
          imports.add(m);
        }
      }
      Map<String,Object> out=new LinkedHashMap<>(); out.put("ok",true); out.put("language","java"); out.put("parser","javac"); out.put("strength","real-ast"); out.put("message","Java parsed with javac Tree API without executing source.");
      Map<String,Object> snap=new LinkedHashMap<>(); snap.put("language","java"); snap.put("entities",entities); snap.put("imports",imports); snap.put("exports",List.of()); out.put("snapshot",snap); System.out.print(json(out));
    }
  }
}
