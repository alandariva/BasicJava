
public class Objeto3DNovo {
    
    public static int numInstancias = 0;
    
    protected Vetor3D posicao = new Vetor3D();
    
    public Objeto3DNovo() {
        numInstancias = numInstancias + 1;
    }
    
    Objeto3DNovo mudarPosicaoX(int qtd) {
        int x = posicao.getX() + qtd;
        this.posicao = new Vetor3D(x, this.posicao.getY(), this.posicao.getZ());
        return this;
    }
    
    Objeto3DNovo mudarPosicaoY(int qtd) {
        this.posicao = new Vetor3D(posicao.getX(), this.posicao.getY() + qtd, this.posicao.getZ());
        return this;
    }
    
    Objeto3DNovo mudarPosicaoZ(int qtd) {
        this.posicao = new Vetor3D(posicao.getX(), this.posicao.getY(), this.posicao.getZ() + qtd);
        return this;
    }
    
    void mostrarPosicoes() {
        System.out.println("x: " + posicao.getX() + " y: " + this.posicao.getY() + " z: " + this.posicao.getZ());
    }
    
    void mostrarIdentificacao() {
        System.out.println("Sou um objeto3d");
    }
}
