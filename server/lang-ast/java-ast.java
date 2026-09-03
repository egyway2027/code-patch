import com.sun.source.tree.*;
import com.sun.source.util.*;
import javax.tools.*;
import java.nio.file.*;
import java.util.*;

public class JavaAst {
  static List<Map<String,Object>> entities = new ArrayList<>();
  static List<Map<String,Object>> imports = new ArrayList<>();
  static String json(Object o) {
    if (o == null) return "null";
    if (o instanceof String) return "\"" + ((String)o).replace("\\","\\\\").replace("\"","\\\"").replace("\n","\\n").replace("\r","\\r") + "\"";
    if (o instanceof Number || o instanceof Boolean) return o.toString();
    if (o instanceof List) { StringBuilder b=new StringBuilder("["); for(Object x:(List<?>)o){if(b.length()>1)b.append(',');b.append(json(x));} return b.append(']').toString(); }
    if (o instanceof Map) { StringBuilder b=new StringBuilder("{"); for(var e:((Map<?,?>)o).entrySet()){if(b.length()>1)b.append(',');b.append(json(e.getKey().toString())).append(':').append(json(e.getValue()));} return b.append('}').toString(); }
    return json(String.valueOf(o));
  }
  static Map<String,Object> base(String kind, String name, CompilationUnitTree u, Tree t, SourcePositions sp) {
    Map<String,Object> x=new LinkedHashMap<>(); x.put("kind",kind); x.put("name",name);
    long pos=sp.getStartPosition(u,t); long line=(pos==Diagnostic.NOPOS)?-1:u.getLineMap().getLineNumber(pos); long col=(pos==Diagnostic.NOPOS)?-1:u.getLineMap().getColumnNumber(pos);
    x.put("line",line<0?null:line); x.put("column",col<0?null:col); return x;
  }
  static void emitError(String msg, long line, long col) { Map<String,Object> x=new LinkedHashMap<>(); x.put("ok",false); x.put("language","java"); x.put("parser","javac"); x.put("strength","real-ast"); x.put("error",msg==null?"Java syntax error":msg); x.put("line",line<0?null:line); x.put("column",col<0?null:col); System.out.print(json(x)); }
  public static void main(String[] args) throws Exception {
    if(args.length<1){emitError("missing file",-1,-1);return;}
    JavaCompiler compiler=ToolProvider.getSystemJavaCompiler(); if(compiler==null){emitError("JDK compiler unavailable",-1,-1);return;}
    DiagnosticCollector<JavaFileObject> diagnostics=new DiagnosticCollector<>();
    try(StandardJavaFileManager fm=compiler.getStandardFileManager(diagnostics,null,null)) {
      Iterable<? extends JavaFileObject> fs=fm.getJavaFileObjects(Paths.get(args[0]).toFile());
      JavacTask task=(JavacTask)compiler.getTask(null,fm,diagnostics,Arrays.asList("-proc:none","-Xlint:none"),null,fs);
      Iterable<? extends CompilationUnitTree> units;
      try { units=task.parse(); } catch(Exception e){ emitError(e.getMessage(),-1,-1); return; }
      for(Diagnostic<? extends JavaFileObject> d: diagnostics.getDiagnostics()) {
        if(d.getKind()==Diagnostic.Kind.ERROR){ emitError(d.getMessage(Locale.ROOT),d.getLineNumber(),d.getColumnNumber()); return; }
      }
      SourcePositions sp=Trees.instance(task).getSourcePositions();
      for(CompilationUnitTree u:units){
        new TreePathScanner<Void,Void>(){
          public Void visitClass(ClassTree n,Void v){ entities.add(base("class",n.getSimpleName().toString(),u,n,sp)); return super.visitClass(n,v); }
          public Void visitMethod(MethodTree n,Void v){ Map<String,Object>x=base("method",n.getName().toString(),u,n,sp); List<String> ps=new ArrayList<>(); for(VariableTree p:n.getParameters()) ps.add(p.getName().toString()); x.put("params",ps); entities.add(x); return super.visitMethod(n,v); }
        }.scan(u,null);
        for(ImportTree x:u.getImports()){ Map<String,Object>m=new LinkedHashMap<>(); m.put("source",x.getQualifiedIdentifier().toString()); long pos=sp.getStartPosition(u,x); m.put("line",u.getLineMap().getLineNumber(pos)); m.put("column",u.getLineMap().getColumnNumber(pos)); imports.add(m); }
      }
      Map<String,Object> out=new LinkedHashMap<>(); out.put("ok",true); out.put("language","java"); out.put("parser","javac"); out.put("strength","real-ast"); out.put("message","Java parsed with javac Tree API without executing source.");
      Map<String,Object> snap=new LinkedHashMap<>(); snap.put("language","java"); snap.put("entities",entities); snap.put("imports",imports); snap.put("exports",List.of()); out.put("snapshot",snap); System.out.print(json(out));
    }
  }
}
