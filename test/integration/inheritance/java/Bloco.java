
public class Bloco extends Objeto3DNovo {
    
    void mostrarIdentificacao() {
        System.out.println("Sou um bloco");
        super.mostrarIdentificacao();
    }
    
    Inimigo testeFnc(Inimigo x) {
        x.mudarPosicaoZ(4);
        System.out.println(x.posicao.getZ() + 2);
        this.posicao.setX(2 + x.posicao.getZ());
        Objeto3DNovo.numInstancias = 99;
        x.mudarPosicaoX(55);
        return x;
    }
    
}
