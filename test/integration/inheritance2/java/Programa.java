
public class Programa {

    public static void main(String args[]) {
        Processador p = new Processador();
        p.anoFabricacao = 2016;
        p.bits = 64;
        p.ghz = 3;
        p.nomeMarca = "Intel";
        p.nomePeca = "Processador";
        p.valor = 400;
        p.mostraAtributos();
    }
    
}
