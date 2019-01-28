
public class Processador extends PecaComputador {
    int ghz;
    int bits;
    
    void mostraAtributos() {
        System.out.println("PEÇA:");
        super.mostraAtributos();
        System.out.println("PROCESSADOR:");
        System.out.println("Nome peça: " + nomePeca);
        System.out.println("Nome marca: " + nomeMarca);
        System.out.println("Ano fabricação: " + anoFabricacao);
        System.out.println("valor: " + valor);
        System.out.println("ghz: " + ghz);
        System.out.println("bits: " + bits);
        
    }
}
